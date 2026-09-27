import Foundation

struct APIError: LocalizedError {
    let message: String
    let status: Int?

    var errorDescription: String? { message }

    /// HTTP 401 — the device record was revoked on the desktop.
    var isRevoked: Bool { status == 401 }
}

/// Bearer-authenticated REST client for the `/api/mobile/*` surface.
final class APIClient {
    let baseURL: URL
    let token: String

    private let urlSession: URLSession

    init(baseURL: URL, token: String, urlSession: URLSession = .shared) {
        self.baseURL = baseURL
        self.token = token
        self.urlSession = urlSession
    }

    /// True when the response body is a `{"error": ...}` payload. Several
    /// backend endpoints report failures inside an HTTP 200.
    private struct WireError: Decodable {
        var error: String?
    }

    private func makeRequest(
        _ method: String,
        _ path: String,
        query: [URLQueryItem],
        body: Data?
    ) throws -> URLRequest {
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            throw APIError(message: "Invalid server URL", status: nil)
        }
        components.path = components.path + path
        if !query.isEmpty {
            components.queryItems = query
        }
        guard let url = components.url else {
            throw APIError(message: "Invalid request URL for \(path)", status: nil)
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.timeoutInterval = 30
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        return request
    }

    private func perform(
        _ method: String,
        _ path: String,
        query: [URLQueryItem] = [],
        body: Data? = nil
    ) async throws -> Data {
        let request = try makeRequest(method, path, query: query, body: body)
        let (data, response) = try await urlSession.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode

        if let wire = try? DateCoding.decoder().decode(WireError.self, from: data),
           let message = wire.error, !message.isEmpty {
            throw APIError(message: message, status: status)
        }
        guard let status, (200..<300).contains(status) else {
            let reason: String
            switch status {
            case 401: reason = "This device is no longer paired."
            case 404: reason = "Not found."
            case 409: reason = "Conflict — the agent may still be running."
            default: reason = "Server error"
            }
            throw APIError(message: "\(reason) (HTTP \(status.map(String.init) ?? "?"))", status: status)
        }
        return data
    }

    func get<T: Decodable>(_ path: String, query: [URLQueryItem] = []) async throws -> T {
        let data = try await perform("GET", path, query: query)
        do {
            return try DateCoding.decoder().decode(T.self, from: data)
        } catch {
            throw APIError(message: "Unexpected response from \(path)", status: nil)
        }
    }

    func post<T: Decodable, B: Encodable>(_ path: String, body: B) async throws -> T {
        let bodyData = try JSONEncoder().encode(body)
        let data = try await perform("POST", path, body: bodyData)
        do {
            return try DateCoding.decoder().decode(T.self, from: data)
        } catch {
            throw APIError(message: "Unexpected response from \(path)", status: nil)
        }
    }

    /// POST without a request body; returns the raw JSON response.
    @discardableResult
    func post(_ path: String) async throws -> JSONValue {
        let data = try await perform("POST", path, body: nil)
        return (try? JSONSerialization.jsonObject(with: data)).flatMap(JSONValue.from(any:)) ?? .null
    }

    func delete(_ path: String) async throws {
        _ = try await perform("DELETE", path, body: nil)
    }
}
