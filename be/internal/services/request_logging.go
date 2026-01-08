package services

import (
	"strings"
	"time"

	"be/utils"

	"github.com/charmbracelet/log"
	"github.com/gofiber/fiber/v2"
)

const reqIDKey = "reqId"

func RequestLogger() fiber.Handler {
	base := log.With("component", "http")

	return func(c *fiber.Ctx) error {
		reqID := utils.NewJobID()
		c.Locals(reqIDKey, reqID)
		c.Set("X-Request-Id", reqID)

		start := time.Now()
		path := c.Path()
		method := c.Method()
		ip := c.IP()

		// The User-Agent can get extremely long; keep it bounded.
		ua := strings.TrimSpace(string(c.Context().UserAgent()))
		if len(ua) > 200 {
			ua = ua[:200]
		}

		base.Debug("request started", "reqId", reqID, "method", method, "path", path, "ip", ip, "ua", ua)

		err := c.Next()
		dur := time.Since(start)

		status := c.Response().StatusCode()
		if err != nil {
			base.Error("request failed", "reqId", reqID, "method", method, "path", path, "status", status, "dur", dur.String(), "err", err)
			return err
		}

		base.Info("request completed", "reqId", reqID, "method", method, "path", path, "status", status, "dur", dur.String())
		return nil
	}
}

func ReqID(c *fiber.Ctx) string {
	if v := c.Locals(reqIDKey); v != nil {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

func HttpLogger(action string, c *fiber.Ctx) *log.Logger {
	return log.With(
		"component", "api",
		"action", action,
		"reqId", ReqID(c),
		"method", c.Method(),
		"path", c.Path(),
	)
}
