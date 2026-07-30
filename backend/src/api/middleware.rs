use axum::{
    extract::Request,
    middleware::Next,
    response::Response,
};

pub async fn auth_middleware(
    request: Request,
    next: Next,
) -> Response {
    // TODO: Implement JWT/token validation
    next.run(request).await
}
