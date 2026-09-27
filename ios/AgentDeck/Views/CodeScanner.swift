import AVFoundation
import SwiftUI

/// Full-screen QR scanner. Falls back to a manual paste field when no camera
/// is available (e.g. the simulator).
struct ScannerView: View {
    let onCode: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var cameraReady = false
    @State private var cameraUnavailable = false
    @State private var manualText = ""

    var body: some View {
        NavigationStack {
            ZStack {
                if cameraUnavailable {
                    Theme.background.ignoresSafeArea()
                    VStack(spacing: 20) {
                        Image(systemName: "camera.on.rectangle")
                            .font(.system(size: 48))
                            .foregroundStyle(.secondary)
                            .accessibilityHidden(true)
                        Text("No camera available. Paste the pairing link instead.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        TextField("http://192.168.1.5:9120/mobile/pair?offer=…&secret=…", text: $manualText)
                            .textFieldStyle(.roundedBorder)
                            .autocorrectionDisabled()
                            .textInputAutocapitalization(.never)
                            .padding(.horizontal, 24)
                        Button("Use link") {
                            handleCode(manualText)
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(manualText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                    .padding()
                } else {
                    CodeScannerController(
                        onReady: { cameraReady = true },
                        onCode: { handleCode($0) },
                        onUnavailable: {
                            cameraUnavailable = true
                        }
                    )
                    .ignoresSafeArea()

                    if !cameraReady {
                        Theme.background.ignoresSafeArea()
                        ProgressView("Requesting camera…")
                    }
                }
            }
            .navigationTitle("Scan pairing code")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }

    private func handleCode(_ code: String) {
        let trimmed = code.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        dismiss()
        onCode(trimmed)
    }
}

/// Wraps an `AVCaptureSession` configured for QR detection.
private struct CodeScannerController: UIViewControllerRepresentable {
    let onReady: () -> Void
    let onCode: (String) -> Void
    let onUnavailable: () -> Void

    func makeUIViewController(context: Context) -> ScannerController {
        let controller = ScannerController()
        controller.onReady = onReady
        controller.onCode = onCode
        controller.onUnavailable = onUnavailable
        return controller
    }

    func updateUIViewController(_ controller: ScannerController, context: Context) {}
}

private final class ScannerController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    var onReady: (() -> Void)?
    var onCode: ((String) -> Void)?
    var onUnavailable: (() -> Void)?

    private let captureSession = AVCaptureSession()
    private var previewLayer: AVCaptureVideoPreviewLayer?
    private var finished = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        configureSession()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer?.frame = view.bounds
    }

    private func configureSession() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            setupSession()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                DispatchQueue.main.async {
                    if granted {
                        self?.setupSession()
                    } else {
                        self?.notifyUnavailable()
                    }
                }
            }
        default:
            notifyUnavailable()
        }
    }

    private func setupSession() {
        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
              let input = try? AVCaptureDeviceInput(device: device)
        else {
            notifyUnavailable()
            return
        }

        captureSession.beginConfiguration()
        guard captureSession.canAddInput(input) else {
            captureSession.commitConfiguration()
            notifyUnavailable()
            return
        }
        captureSession.addInput(input)

        let output = AVCaptureMetadataOutput()
        guard captureSession.canAddOutput(output) else {
            captureSession.commitConfiguration()
            notifyUnavailable()
            return
        }
        captureSession.addOutput(output)
        output.setMetadataObjectsDelegate(self, queue: .main)
        output.metadataObjectTypes = [.qr]
        captureSession.commitConfiguration()

        let previewLayer = AVCaptureVideoPreviewLayer(session: captureSession)
        previewLayer.videoGravity = .resizeAspectFill
        previewLayer.frame = view.bounds
        view.layer.addSublayer(previewLayer)
        self.previewLayer = previewLayer

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            self.captureSession.startRunning()
            DispatchQueue.main.async {
                self.onReady?()
            }
        }
    }

    private func notifyUnavailable() {
        guard !finished else { return }
        DispatchQueue.main.async { [weak self] in
            self?.onUnavailable?()
        }
    }

    func metadataOutput(
        _ output: AVCaptureMetadataOutput,
        didOutput metadataObjects: [AVMetadataObject],
        from connection: AVCaptureConnection
    ) {
        guard !finished,
              let object = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
              object.type == .qr,
              let value = object.stringValue
        else { return }
        // Stop scanning after the first hit so the callback fires once.
        finished = true
        if captureSession.isRunning {
            captureSession.stopRunning()
        }
        onCode?(value)
    }
}
