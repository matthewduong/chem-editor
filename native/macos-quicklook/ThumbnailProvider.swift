// QuickLook thumbnail extension for CDXML files (macOS 10.15+).
//
// UNBUILT: written on Linux, never compiled. Build and test on a Mac (README.md).
//
// The extension runs the app's bundled sidecar, `chem-engine thumbnail INPUT OUTPUT SIZE`, the
// same command the Linux thumbnailer uses (src-tauri/bin/chem-engine.py, tested there), and
// hands the PNG it writes to QuickLook.
import Foundation
import QuickLookThumbnailing
import os

private let log = Logger(subsystem: "com.mrd.chem-editor.cdxml-thumbnail", category: "thumbnail")

final class ThumbnailProvider: QLThumbnailProvider {
    enum Failure: Error { case noEngine, engineFailed }

    /// ChemEditor.app/Contents/PlugIns/CDXMLThumbnail.appex → ChemEditor.app/Contents/Resources/bin
    private func engineURL() -> URL? {
        let resources = Bundle.main.bundleURL
            .deletingLastPathComponent() // PlugIns
            .deletingLastPathComponent() // Contents
            .appendingPathComponent("Resources/bin", isDirectory: true)
        let entries: [URL]
        do {
            entries = try FileManager.default.contentsOfDirectory(
                at: resources, includingPropertiesForKeys: nil)
        } catch {
            log.error("cannot list \(resources.path, privacy: .public): \(error.localizedDescription, privacy: .public)")
            return nil
        }
        return entries
            .filter { $0.lastPathComponent.hasPrefix("chem-engine-") }
            .map { $0.appendingPathComponent("chem-engine") }
            .first { FileManager.default.isExecutableFile(atPath: $0.path) }
    }

    override func provideThumbnail(
        for request: QLFileThumbnailRequest,
        _ handler: @escaping (QLThumbnailReply?, Error?) -> Void
    ) {
        guard let engine = engineURL() else {
            log.error("no engine under \(Bundle.main.bundleURL.path, privacy: .public)")
            handler(nil, Failure.noEngine)
            return
        }
        let side = Int(max(request.maximumSize.width, request.maximumSize.height) * request.scale)
        let output = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension("png")
        let process = Process()
        process.executableURL = engine
        process.arguments = ["thumbnail", request.fileURL.path, output.path, String(max(side, 16))]
        do {
            try process.run()
            process.waitUntilExit()
        } catch {
            handler(nil, error)
            return
        }
        guard process.terminationStatus == 0,
              FileManager.default.fileExists(atPath: output.path) else {
            handler(nil, Failure.engineFailed)
            return
        }
        handler(QLThumbnailReply(imageFileURL: output), nil)
    }
}
