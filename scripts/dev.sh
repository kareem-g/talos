#!/bin/bash

echo "🚀 Starting development environment..."

# Start backend in background
cd backend
cargo run &
BACKEND_PID=$!
cd ..

# Start dashboard dev server
cd dashboard
pnpm dev &
DASHBOARD_PID=$!
cd ..

echo ""
echo "Backend PID: $BACKEND_PID"
echo "Dashboard PID: $DASHBOARD_PID"
echo ""
echo "Press Ctrl+C to stop all services"

# Wait for interrupt
trap "kill $BACKEND_PID $DASHBOARD_PID 2>/dev/null; exit" INT TERM
wait
