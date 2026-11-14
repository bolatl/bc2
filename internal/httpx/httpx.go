package httpx

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"lovelab/internal/service"
	"mime"
	"net/http"
)

type ErrorResponse struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func JSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if status != 204 {
		_ = json.NewEncoder(w).Encode(value)
	}
}
func Error(w http.ResponseWriter, err error) {
	var e *service.Error
	if errors.As(err, &e) {
		JSON(w, e.Status, ErrorResponse{Code: e.Code, Message: e.Message})
		return
	}
	JSON(w, 500, ErrorResponse{Code: "internal_error", Message: "An internal error occurred."})
}
func Decode(w http.ResponseWriter, r *http.Request, out any, allowEmpty bool, required ...string) error {
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 32*1024))
	if err != nil {
		var size *http.MaxBytesError
		if errors.As(err, &size) {
			return &service.Error{Status: 413, Code: "payload_too_large", Message: "Request body exceeds 32 KiB."}
		}
		return &service.Error{Status: 400, Code: "validation_error", Message: "Could not read the request body."}
	}
	data = bytes.TrimSpace(data)
	if len(data) == 0 && allowEmpty {
		return nil
	}
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "application/json" {
		return &service.Error{Status: 415, Code: "unsupported_media_type", Message: "Use Content-Type: application/json."}
	}
	invalid := func() error {
		return &service.Error{Status: 400, Code: "validation_error", Message: "Expected a JSON object with valid fields and types."}
	}
	if len(data) == 0 || data[0] != '{' {
		return invalid()
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(out); err != nil {
		return invalid()
	}
	if decoder.Decode(new(any)) != io.EOF {
		return invalid()
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return invalid()
	}
	for field, value := range fields {
		if field != "rating" && bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			return invalid()
		}
	}
	for _, field := range required {
		if _, ok := fields[field]; !ok {
			return &service.Error{Status: 400, Code: "validation_error", Message: field + " is required."}
		}
	}
	return nil
}
