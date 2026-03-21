FROM golang:1.22-alpine AS builder

WORKDIR /build
COPY collector/ .
RUN go mod download
RUN CGO_ENABLED=0 GOOS=linux go build -o overseer-collector ./cmd/

FROM alpine:3.19
RUN apk add --no-cache ca-certificates iputils
COPY --from=builder /build/overseer-collector /usr/local/bin/
CMD ["overseer-collector"]
