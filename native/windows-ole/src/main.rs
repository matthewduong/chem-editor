//! ChemEditor as an OLE embedding server ("ChemEditor.Document"), open editing only.
//!
//! UNBUILT: written on Linux, never compiled. Build and test on Windows (../README.md).
//!
//! A container (Word, PowerPoint) embeds a drawing as an object whose storage holds its CDXML
//! (stream "CDXML"). The container draws the object from the picture it caches, which this
//! server supplies as a device-independent bitmap rendered by the sidecar's `thumbnail` command.
//! Double-clicking the object (OLEIVERB_PRIMARY / OPEN) writes the CDXML to a temporary file,
//! runs ChemEditor.exe on it, waits for it to close, reads the edited file back into the
//! storage, and tells the container to save and redraw. In-place activation is not offered.
#![cfg(windows)]
#![allow(non_snake_case)]

use std::cell::RefCell;
use std::path::PathBuf;
use std::process::Command;

use windows::core::{implement, Interface, Result, GUID, HRESULT, PCWSTR};
use windows::Win32::Foundation::{
    BOOL, E_FAIL, E_NOTIMPL, OLE_E_ADVISENOTSUPPORTED, OLE_E_NOCONNECTION, OLE_S_USEREG, POINTL, RECT,
    S_OK, SIZE,
};
use windows::Win32::System::Com::StructuredStorage::{IPersistStorage, IPersistStorage_Impl, IStorage};
use windows::Win32::System::Com::{
    CoRegisterClassObject, CoRevokeClassObject, IPersist_Impl, IAdviseSink, IClassFactory, IClassFactory_Impl,
    IDataObject, IDataObject_Impl, IEnumFORMATETC, IEnumSTATDATA, IStream, CLSCTX_LOCAL_SERVER,
    DVASPECT, DVASPECT_CONTENT, FORMATETC, REGCLS_SINGLEUSE,
    STGMEDIUM, STGM_CREATE, STGM_READ, STGM_READWRITE, STGM_SHARE_EXCLUSIVE, TYMED_HGLOBAL,
};
use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
use windows::Win32::System::Ole::{
    CreateOleAdviseHolder, IOleAdviseHolder, IOleClientSite, IOleObject, IOleObject_Impl,
    OLECLOSE, OLEGETMONIKER, OLEMISC, OLEWHICHMK, USERCLASSTYPE, CF_DIB, OLEMISC_RECOMPOSEONRESIZE,
};
use windows::Win32::UI::WindowsAndMessaging::{DispatchMessageW, GetMessageW, PostQuitMessage, MSG};

/// {3B7C9E21-58A4-4F0D-B2C6-7E1D94A5C803}: "ChemEditor.Document".
pub const CLSID_CHEM_EDITOR_DOCUMENT: GUID = GUID::from_u128(0x3b7c9e21_58a4_4f0d_b2c6_7e1d94a5c803);

const STREAM: PCWSTR = windows::core::w!("CDXML");
const EMPTY_CDXML: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\" ?>\n<CDXML><page id=\"1\"/></CDXML>\n";

fn fail() -> windows::core::Error {
    E_FAIL.into()
}

/// ChemEditor.exe and its sidecar, beside this server.
fn install_dir() -> Result<PathBuf> {
    std::env::current_exe().ok().and_then(|p| p.parent().map(PathBuf::from)).ok_or_else(fail)
}

fn engine() -> Result<PathBuf> {
    std::fs::read_dir(install_dir()?.join("bin"))
        .map_err(|_| fail())?
        .filter_map(|e| e.ok().map(|e| e.path().join("chem-engine.exe")))
        .find(|p| p.is_file())
        .ok_or_else(fail)
}

/// The drawing as a packed 32-bit DIB (BITMAPINFOHEADER then bottom-up BGRA rows), decoded with
/// WIC from the PNG the sidecar renders.
fn picture(cdxml: &str) -> Result<Vec<u8>> {
    use windows::Win32::Graphics::Imaging::{
        CLSID_WICImagingFactory, GUID_WICPixelFormat32bppBGRA, IWICImagingFactory, WICBitmapDitherTypeNone,
        WICBitmapPaletteTypeCustom, WICDecodeMetadataCacheOnDemand,
    };
    let dir = std::env::temp_dir();
    let id = std::process::id();
    let input = dir.join(format!("chem-editor-ole-{id}.cdxml"));
    let output = dir.join(format!("chem-editor-ole-{id}.png"));
    std::fs::write(&input, cdxml).map_err(|_| fail())?;
    let ok = Command::new(engine()?)
        .args(["thumbnail", &input.to_string_lossy(), &output.to_string_lossy(), "512"])
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    let _ = std::fs::remove_file(&input);
    if !ok {
        return Err(fail());
    }
    let png = std::fs::read(&output).map_err(|_| fail())?;
    let _ = std::fs::remove_file(&output);
    unsafe {
        let factory: IWICImagingFactory =
            windows::Win32::System::Com::CoCreateInstance(&CLSID_WICImagingFactory, None, windows::Win32::System::Com::CLSCTX_INPROC_SERVER)?;
        let stream = factory.CreateStream()?;
        stream.InitializeFromMemory(&png)?;
        let decoder = factory.CreateDecoderFromStream(&stream, std::ptr::null(), WICDecodeMetadataCacheOnDemand)?;
        let converter = factory.CreateFormatConverter()?;
        converter.Initialize(&decoder.GetFrame(0)?, &GUID_WICPixelFormat32bppBGRA, WICBitmapDitherTypeNone, None, 0.0, WICBitmapPaletteTypeCustom)?;
        let (mut width, mut height) = (0u32, 0u32);
        converter.GetSize(&mut width, &mut height)?;
        let stride = width * 4;
        let mut top_down = vec![0u8; (stride * height) as usize];
        converter.CopyPixels(std::ptr::null(), stride, &mut top_down)?;
        let header = windows::Win32::Graphics::Gdi::BITMAPINFOHEADER {
            biSize: std::mem::size_of::<windows::Win32::Graphics::Gdi::BITMAPINFOHEADER>() as u32,
            biWidth: width as i32,
            biHeight: height as i32, // bottom-up, the form every CF_DIB reader takes
            biPlanes: 1,
            biBitCount: 32,
            biCompression: windows::Win32::Graphics::Gdi::BI_RGB.0,
            biSizeImage: stride * height,
            ..Default::default()
        };
        let mut dib = std::slice::from_raw_parts(
            (&header as *const windows::Win32::Graphics::Gdi::BITMAPINFOHEADER).cast::<u8>(),
            header.biSize as usize,
        )
        .to_vec();
        for row in (0..height as usize).rev() {
            dib.extend_from_slice(&top_down[row * stride as usize..(row + 1) * stride as usize]);
        }
        Ok(dib)
    }
}

#[implement(IOleObject, IDataObject, IPersistStorage)]
struct Document {
    cdxml: RefCell<String>,
    storage: RefCell<Option<IStorage>>,
    site: RefCell<Option<IOleClientSite>>,
    advise: RefCell<Option<IOleAdviseHolder>>,
    extent: RefCell<SIZE>,
}

impl Document {
    fn new() -> Self {
        Self {
            cdxml: RefCell::new(EMPTY_CDXML.to_string()),
            storage: RefCell::new(None),
            site: RefCell::new(None),
            advise: RefCell::new(None),
            extent: RefCell::new(SIZE { cx: 5000, cy: 3000 }), // HIMETRIC
        }
    }

    fn write_storage(&self, storage: &IStorage) -> Result<()> {
        unsafe {
            let stream: IStream = storage.CreateStream(STREAM, STGM_CREATE | STGM_READWRITE | STGM_SHARE_EXCLUSIVE, 0, 0)?;
            let bytes = self.cdxml.borrow().clone().into_bytes();
            stream.Write(bytes.as_ptr().cast(), bytes.len() as u32, None).ok()
        }
    }

    fn read_storage(&self, storage: &IStorage) -> Result<()> {
        unsafe {
            let stream = storage.OpenStream(STREAM, None, STGM_READ | STGM_SHARE_EXCLUSIVE, 0)?;
            let mut bytes = Vec::new();
            let mut chunk = [0u8; 65536];
            loop {
                let mut read = 0u32;
                stream.Read(chunk.as_mut_ptr().cast(), chunk.len() as u32, Some(&mut read)).ok()?;
                if read == 0 {
                    break;
                }
                bytes.extend_from_slice(&chunk[..read as usize]);
            }
            *self.cdxml.borrow_mut() = String::from_utf8(bytes).map_err(|_| fail())?;
        }
        Ok(())
    }

    /// Open editing: ChemEditor on a temporary copy, the edits read back when it closes.
    fn edit(&self) -> Result<()> {
        let path = std::env::temp_dir().join(format!("chem-editor-object-{}.cdxml", std::process::id()));
        std::fs::write(&path, self.cdxml.borrow().as_bytes()).map_err(|_| fail())?;
        let status = Command::new(install_dir()?.join("ChemEditor.exe")).arg(&path).status();
        let edited = std::fs::read_to_string(&path);
        let _ = std::fs::remove_file(&path);
        if status.is_err() {
            return Err(fail());
        }
        if let Ok(text) = edited {
            if text != *self.cdxml.borrow() {
                *self.cdxml.borrow_mut() = text;
                unsafe {
                    if let Some(site) = self.site.borrow().as_ref() {
                        let _ = site.SaveObject();
                    }
                    if let Some(holder) = self.advise.borrow().as_ref() {
                        let _ = holder.SendOnSave();
                    }
                }
            }
        }
        Ok(())
    }
}

impl IPersist_Impl for Document_Impl {
    fn GetClassID(&self) -> Result<GUID> {
        Ok(CLSID_CHEM_EDITOR_DOCUMENT)
    }
}

impl IPersistStorage_Impl for Document_Impl {
    fn IsDirty(&self) -> HRESULT {
        S_OK
    }
    fn InitNew(&self, storage: Option<&IStorage>) -> Result<()> {
        *self.storage.borrow_mut() = storage.cloned();
        Ok(())
    }
    fn Load(&self, storage: Option<&IStorage>) -> Result<()> {
        let storage = storage.ok_or_else(fail)?;
        self.read_storage(storage)?;
        *self.storage.borrow_mut() = Some(storage.clone());
        Ok(())
    }
    fn Save(&self, storage: Option<&IStorage>, _same: BOOL) -> Result<()> {
        self.write_storage(storage.ok_or_else(fail)?)
    }
    fn SaveCompleted(&self, storage: Option<&IStorage>) -> Result<()> {
        if let Some(storage) = storage {
            *self.storage.borrow_mut() = Some(storage.clone());
        }
        Ok(())
    }
    fn HandsOffStorage(&self) -> Result<()> {
        *self.storage.borrow_mut() = None;
        Ok(())
    }
}

impl IDataObject_Impl for Document_Impl {
    fn GetData(&self, format: *const FORMATETC) -> Result<STGMEDIUM> {
        let format = unsafe { format.as_ref() }.ok_or_else(fail)?;
        if format.cfFormat != CF_DIB.0 || format.tymed & TYMED_HGLOBAL.0 as u32 == 0 {
            return Err(windows::Win32::Foundation::DV_E_FORMATETC.into());
        }
        let dib = picture(&self.cdxml.borrow())?;
        unsafe {
            let global = GlobalAlloc(GMEM_MOVEABLE, dib.len())?;
            let target = GlobalLock(global);
            std::ptr::copy_nonoverlapping(dib.as_ptr(), target.cast(), dib.len());
            let _ = GlobalUnlock(global);
            let mut medium = STGMEDIUM::default();
            medium.tymed = TYMED_HGLOBAL.0 as u32;
            medium.u.hGlobal = global;
            Ok(medium)
        }
    }
    fn GetDataHere(&self, _: *const FORMATETC, _: *mut STGMEDIUM) -> Result<()> {
        Err(E_NOTIMPL.into())
    }
    fn QueryGetData(&self, format: *const FORMATETC) -> HRESULT {
        match unsafe { format.as_ref() } {
            Some(f) if f.cfFormat == CF_DIB.0 && f.dwAspect == DVASPECT_CONTENT.0 as u32 => S_OK,
            _ => windows::Win32::Foundation::DV_E_FORMATETC,
        }
    }
    fn GetCanonicalFormatEtc(&self, _: *const FORMATETC, out: *mut FORMATETC) -> HRESULT {
        if let Some(out) = unsafe { out.as_mut() } {
            out.ptd = std::ptr::null_mut();
        }
        windows::Win32::Foundation::DATA_S_SAMEFORMATETC
    }
    fn SetData(&self, _: *const FORMATETC, _: *const STGMEDIUM, _: BOOL) -> Result<()> {
        Err(E_NOTIMPL.into())
    }
    fn EnumFormatEtc(&self, _: u32) -> Result<IEnumFORMATETC> {
        Err(OLE_S_USEREG.into())
    }
    fn DAdvise(&self, _: *const FORMATETC, _: u32, _: Option<&IAdviseSink>) -> Result<u32> {
        Err(OLE_E_ADVISENOTSUPPORTED.into())
    }
    fn DUnadvise(&self, _: u32) -> Result<()> {
        Err(OLE_E_ADVISENOTSUPPORTED.into())
    }
    fn EnumDAdvise(&self) -> Result<IEnumSTATDATA> {
        Err(OLE_E_ADVISENOTSUPPORTED.into())
    }
}

impl IOleObject_Impl for Document_Impl {
    fn SetClientSite(&self, site: Option<&IOleClientSite>) -> Result<()> {
        *self.site.borrow_mut() = site.cloned();
        Ok(())
    }
    fn GetClientSite(&self) -> Result<IOleClientSite> {
        self.site.borrow().clone().ok_or_else(|| OLE_E_NOCONNECTION.into())
    }
    fn SetHostNames(&self, _: &PCWSTR, _: &PCWSTR) -> Result<()> {
        Ok(())
    }
    fn Close(&self, _: &OLECLOSE) -> Result<()> {
        unsafe {
            if let Some(holder) = self.advise.borrow().as_ref() {
                let _ = holder.SendOnClose();
            }
        }
        PostQuit();
        Ok(())
    }
    fn SetMoniker(&self, _: &OLEWHICHMK, _: Option<&windows::Win32::System::Com::IMoniker>) -> Result<()> {
        Err(E_NOTIMPL.into())
    }
    fn GetMoniker(&self, _: &OLEGETMONIKER, _: &OLEWHICHMK) -> Result<windows::Win32::System::Com::IMoniker> {
        Err(E_NOTIMPL.into())
    }
    fn InitFromData(&self, _: Option<&IDataObject>, _: BOOL, _: u32) -> Result<()> {
        Err(E_NOTIMPL.into())
    }
    fn GetClipboardData(&self, _: u32) -> Result<IDataObject> {
        Err(E_NOTIMPL.into())
    }
    fn DoVerb(
        &self,
        _verb: i32,
        _msg: *const MSG,
        _site: Option<&IOleClientSite>,
        _index: i32,
        _parent: windows::Win32::Foundation::HWND,
        _rect: *const RECT,
    ) -> Result<()> {
        // Every verb opens the drawing in ChemEditor; there is no in-place editing.
        self.edit()
    }
    fn EnumVerbs(&self) -> Result<windows::Win32::System::Ole::IEnumOLEVERB> {
        Err(OLE_S_USEREG.into())
    }
    fn Update(&self) -> Result<()> {
        Ok(())
    }
    fn IsUpToDate(&self) -> Result<()> {
        Ok(())
    }
    fn GetUserClassID(&self) -> Result<GUID> {
        Ok(CLSID_CHEM_EDITOR_DOCUMENT)
    }
    fn GetUserType(&self, _: &USERCLASSTYPE) -> Result<windows::core::PWSTR> {
        Err(OLE_S_USEREG.into())
    }
    fn SetExtent(&self, _: DVASPECT, size: *const SIZE) -> Result<()> {
        if let Some(size) = unsafe { size.as_ref() } {
            *self.extent.borrow_mut() = *size;
        }
        Ok(())
    }
    fn GetExtent(&self, _: DVASPECT) -> Result<SIZE> {
        Ok(*self.extent.borrow())
    }
    fn Advise(&self, sink: Option<&IAdviseSink>) -> Result<u32> {
        let mut holder = self.advise.borrow_mut();
        if holder.is_none() {
            *holder = Some(unsafe { CreateOleAdviseHolder()? });
        }
        unsafe { holder.as_ref().unwrap_or_else(|| unreachable!()).Advise(sink) }
    }
    fn Unadvise(&self, connection: u32) -> Result<()> {
        match self.advise.borrow().as_ref() {
            Some(holder) => unsafe { holder.Unadvise(connection) },
            None => Err(OLE_E_NOCONNECTION.into()),
        }
    }
    fn EnumAdvise(&self) -> Result<IEnumSTATDATA> {
        Err(E_NOTIMPL.into())
    }
    fn GetMiscStatus(&self, _: DVASPECT) -> Result<OLEMISC> {
        Ok(OLEMISC_RECOMPOSEONRESIZE)
    }
    fn SetColorScheme(&self, _: *const windows::Win32::Graphics::Gdi::LOGPALETTE) -> Result<()> {
        Err(E_NOTIMPL.into())
    }
}

fn PostQuit() {
    unsafe { PostQuitMessage(0) };
}

#[implement(IClassFactory)]
struct Factory;

impl IClassFactory_Impl for Factory_Impl {
    fn CreateInstance(
        &self,
        outer: Option<&windows::core::IUnknown>,
        iid: *const GUID,
        object: *mut *mut core::ffi::c_void,
    ) -> Result<()> {
        if outer.is_some() {
            return Err(windows::Win32::Foundation::CLASS_E_NOAGGREGATION.into());
        }
        let document: IOleObject = Document::new().into();
        unsafe { document.query(iid, object).ok() }
    }
    fn LockServer(&self, _: BOOL) -> Result<()> {
        Ok(())
    }
}

/// Run as `chem-editor-ole -Embedding`, as COM starts a LocalServer32.
fn main() -> Result<()> {
    unsafe {
        windows::Win32::System::Ole::OleInitialize(None)?;
        let factory: IClassFactory = Factory.into();
        let cookie = CoRegisterClassObject(&CLSID_CHEM_EDITOR_DOCUMENT, &factory, CLSCTX_LOCAL_SERVER, REGCLS_SINGLEUSE)?;
        let mut message = MSG::default();
        while GetMessageW(&mut message, None, 0, 0).as_bool() {
            DispatchMessageW(&message);
        }
        let _ = CoRevokeClassObject(cookie);
        windows::Win32::System::Ole::OleUninitialize();
    }
    let _ = (POINTL::default(), S_OK, E_FAIL);
    Ok(())
}
