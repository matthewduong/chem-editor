//! Windows Explorer thumbnails for CDXML files: an in-process `IThumbnailProvider`.
//!
//! UNBUILT: written on Linux, never compiled. Build and test on Windows (README.md).
//!
//! The shell hands the file over as a stream; it is written to a temporary file, the installed
//! sidecar renders it (`chem-engine thumbnail INPUT OUTPUT SIZE`, the command the Linux
//! thumbnailer uses and its tests cover), and the PNG is decoded with WIC into the bitmap the
//! shell asks for.
#![cfg(windows)]

use std::cell::RefCell;
use std::ffi::c_void;
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicU32, Ordering};

use windows::core::{implement, Interface, Result, GUID, HRESULT};
use windows::Win32::Foundation::{
    BOOL, CLASS_E_CLASSNOTAVAILABLE, E_FAIL, E_POINTER, HINSTANCE, S_FALSE, S_OK,
};
use windows::Win32::Graphics::Gdi::{CreateDIBSection, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HBITMAP};
use windows::Win32::Graphics::Imaging::{
    CLSID_WICImagingFactory, GUID_WICPixelFormat32bppBGRA, IWICImagingFactory,
    WICBitmapDitherTypeNone, WICBitmapPaletteTypeCustom, WICDecodeMetadataCacheOnDemand,
};
use windows::Win32::System::Com::{
    CoCreateInstance, IClassFactory, IClassFactory_Impl, IStream, CLSCTX_INPROC_SERVER, STATFLAG_NONAME,
};
use windows::Win32::System::LibraryLoader::GetModuleFileNameW;
use windows::Win32::UI::Shell::PropertiesSystem::{IInitializeWithStream, IInitializeWithStream_Impl};
use windows::Win32::UI::Shell::{IThumbnailProvider, IThumbnailProvider_Impl, WTSAT_ARGB, WTS_ALPHATYPE};

/// {6F2E3A5C-1B7D-4C2E-9A61-0C5D8E7F4B21}; register it for `.cdxml` (README.md).
pub const CLSID_CDXML_THUMBNAIL: GUID = GUID::from_u128(0x6f2e3a5c_1b7d_4c2e_9a61_0c5d8e7f4b21);

static MODULE: AtomicU32 = AtomicU32::new(0);
static mut MODULE_HANDLE: HINSTANCE = HINSTANCE(std::ptr::null_mut());

#[implement(IInitializeWithStream, IThumbnailProvider)]
struct Provider {
    stream: RefCell<Option<IStream>>,
}

impl IInitializeWithStream_Impl for Provider_Impl {
    fn Initialize(&self, stream: Option<&IStream>, _mode: u32) -> Result<()> {
        *self.stream.borrow_mut() = stream.cloned();
        Ok(())
    }
}

impl IThumbnailProvider_Impl for Provider_Impl {
    fn GetThumbnail(&self, cx: u32, phbmp: *mut HBITMAP, pdwalpha: *mut WTS_ALPHATYPE) -> Result<()> {
        if phbmp.is_null() || pdwalpha.is_null() {
            return Err(E_POINTER.into());
        }
        let stream = self.stream.borrow().clone().ok_or(windows::core::Error::from(E_FAIL))?;
        let png = render(&read_all(&stream)?, cx)?;
        let bitmap = decode_png(&png, cx)?;
        unsafe {
            *phbmp = bitmap;
            *pdwalpha = WTSAT_ARGB;
        }
        Ok(())
    }
}

fn read_all(stream: &IStream) -> Result<Vec<u8>> {
    let mut stat = Default::default();
    unsafe { stream.Stat(&mut stat, STATFLAG_NONAME)? };
    let size = usize::try_from(stat.cbSize).map_err(|_| windows::core::Error::from(E_FAIL))?;
    let mut bytes = vec![0u8; size];
    let mut read = 0u32;
    unsafe {
        stream
            .Read(bytes.as_mut_ptr().cast(), u32::try_from(size).unwrap_or(u32::MAX), Some(&mut read))
            .ok()?;
    }
    bytes.truncate(read as usize);
    Ok(bytes)
}

/// The directory this DLL was installed to; the sidecar sits under its `bin`.
fn install_dir() -> Option<PathBuf> {
    let mut buffer = [0u16; 1024];
    let length = unsafe { GetModuleFileNameW(MODULE_HANDLE, &mut buffer) } as usize;
    let path = PathBuf::from(String::from_utf16_lossy(&buffer[..length]));
    path.parent().map(PathBuf::from)
}

fn render(cdxml: &[u8], size: u32) -> Result<Vec<u8>> {
    let fail = || windows::core::Error::from(E_FAIL);
    let bin = install_dir().ok_or_else(fail)?.join("bin");
    let engine = std::fs::read_dir(&bin)
        .map_err(|_| fail())?
        .filter_map(|entry| entry.ok().map(|e| e.path().join("chem-engine.exe")))
        .find(|candidate| candidate.is_file())
        .ok_or_else(fail)?;
    let directory = std::env::temp_dir();
    let stamp = std::process::id();
    let input = directory.join(format!("chem-editor-thumb-{stamp}.cdxml"));
    let output = directory.join(format!("chem-editor-thumb-{stamp}.png"));
    std::fs::write(&input, cdxml).map_err(|_| fail())?;
    let status = Command::new(engine)
        .arg("thumbnail")
        .arg(&input)
        .arg(&output)
        .arg(size.max(16).to_string())
        .status();
    let _ = std::fs::remove_file(&input);
    if !status.map(|s| s.success()).unwrap_or(false) {
        return Err(fail());
    }
    let png = std::fs::read(&output).map_err(|_| fail());
    let _ = std::fs::remove_file(&output);
    png
}

fn decode_png(png: &[u8], size: u32) -> Result<HBITMAP> {
    unsafe {
        let factory: IWICImagingFactory = CoCreateInstance(&CLSID_WICImagingFactory, None, CLSCTX_INPROC_SERVER)?;
        let stream = factory.CreateStream()?;
        stream.InitializeFromMemory(png)?;
        let decoder = factory.CreateDecoderFromStream(&stream, std::ptr::null(), WICDecodeMetadataCacheOnDemand)?;
        let frame = decoder.GetFrame(0)?;
        let converter = factory.CreateFormatConverter()?;
        converter.Initialize(
            &frame,
            &GUID_WICPixelFormat32bppBGRA,
            WICBitmapDitherTypeNone,
            None,
            0.0,
            WICBitmapPaletteTypeCustom,
        )?;
        let (mut width, mut height) = (0u32, 0u32);
        converter.GetSize(&mut width, &mut height)?;
        let _ = size;
        let info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width as i32,
                biHeight: -(height as i32), // top-down rows
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut bits: *mut c_void = std::ptr::null_mut();
        let bitmap = CreateDIBSection(None, &info, DIB_RGB_COLORS, &mut bits, None, 0)?;
        let stride = width * 4;
        let buffer = std::slice::from_raw_parts_mut(bits.cast::<u8>(), (stride * height) as usize);
        converter.CopyPixels(std::ptr::null(), stride, buffer)?;
        Ok(bitmap)
    }
}

#[implement(IClassFactory)]
struct Factory;

impl IClassFactory_Impl for Factory_Impl {
    fn CreateInstance(
        &self,
        outer: Option<&windows::core::IUnknown>,
        iid: *const GUID,
        object: *mut *mut c_void,
    ) -> Result<()> {
        if outer.is_some() {
            return Err(windows::Win32::Foundation::CLASS_E_NOAGGREGATION.into());
        }
        let provider: IThumbnailProvider = Provider { stream: RefCell::new(None) }.into();
        unsafe { provider.query(iid, object).ok() }
    }

    fn LockServer(&self, lock: BOOL) -> Result<()> {
        if lock.as_bool() {
            MODULE.fetch_add(1, Ordering::SeqCst);
        } else {
            MODULE.fetch_sub(1, Ordering::SeqCst);
        }
        Ok(())
    }
}

#[no_mangle]
extern "system" fn DllMain(module: HINSTANCE, reason: u32, _: *mut c_void) -> BOOL {
    if reason == 1 {
        unsafe { MODULE_HANDLE = module };
    }
    BOOL(1)
}

#[no_mangle]
extern "system" fn DllGetClassObject(clsid: *const GUID, iid: *const GUID, object: *mut *mut c_void) -> HRESULT {
    unsafe {
        if clsid.is_null() || *clsid != CLSID_CDXML_THUMBNAIL {
            return CLASS_E_CLASSNOTAVAILABLE;
        }
        let factory: IClassFactory = Factory.into();
        factory.query(iid, object)
    }
}

#[no_mangle]
extern "system" fn DllCanUnloadNow() -> HRESULT {
    if MODULE.load(Ordering::SeqCst) == 0 {
        S_OK
    } else {
        S_FALSE
    }
}
