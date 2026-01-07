package services

import (
	"strings"

	"github.com/gofiber/contrib/websocket"
	"github.com/gofiber/fiber/v2"
)

func (a *Api) Notifications() fiber.Handler {
	return websocket.New(func(conn *websocket.Conn) {

		clientId := strings.TrimSpace(conn.Query("clientId"))
		if clientId == "" {
			conn.WriteMessage(websocket.CloseMessage, []byte("missing clientId"))
			conn.Close()
			return
		}

		

	})
}
