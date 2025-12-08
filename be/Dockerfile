# Stage 1: Build the Go application
FROM golang:1.25.4-alpine AS builder
ENV GOOS=linux
ENV GOARCH=arm64

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o myapp ./cmd/server

# Stage 2: Create the final, minimal image
FROM alpine:latest

WORKDIR /root/

COPY --from=builder /app/myapp .
COPY --from=builder /app/config ./config

CMD ["./myapp"]
