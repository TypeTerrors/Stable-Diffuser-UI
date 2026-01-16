package services

import (
	"be/config"
	"be/internal/dependencies"
	"context"
	"fmt"

	"github.com/charmbracelet/log"
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
)

type Api struct {
	server         *fiber.App
	rpc            *dependencies.Rpc
	port           string
	allowedOrigins string
	hub            *Hub
	dl             *DownloaderService
	logger         *log.Logger
}

func NewApi(rpc *dependencies.Rpc, config config.ApiConfig, hub *Hub, dl *DownloaderService) *Api {
	if config.AllowedOrigins == "" {
		config.AllowedOrigins = "*"
	}

	return &Api{
		server:         fiber.New(),
		rpc:            rpc,
		port:           config.Port,
		allowedOrigins: config.AllowedOrigins,
		hub:            hub,
		dl:             dl,
		logger:         log.With("component", "api"),
	}
}

func (a *Api) Start() error {

	allowCredentials := a.allowedOrigins != "*"

	a.server.Use(RequestLogger())

	a.server.Use(cors.New(cors.Config{
		AllowOrigins:     a.allowedOrigins,
		AllowCredentials: allowCredentials,
		AllowMethods:     "GET,POST,OPTIONS",
		AllowHeaders:     "Content-Type,Authorization,Accept,Origin",
	}))

	a.addRoutes()

	a.logger.Info("api starting", "port", a.port, "allowedOrigins", a.allowedOrigins, "allowCredentials", allowCredentials)

	if err := a.server.Listen(fmt.Sprint(":", a.port)); err != nil {
		log.Error("api stopped", "err", err)
		return err
	}
	return nil
}

func (a *Api) Shutdown(ctx context.Context) error {
	errCh := make(chan error, 1)
	go func() {
		errCh <- a.server.Shutdown()
	}()
	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (a *Api) addRoutes() {
	a.server.Add("GET", "/health", a.Health())
	a.server.Add("POST", "/generateimage", a.GenerateImage())
	a.server.Add("POST", "/generateimagetovideo", a.GenerateImageToVideo())
	a.server.Add("GET", "/models", a.ListModels())
	a.server.Add("GET", "/loras", a.ListLoras())
	a.server.Add("POST", "/setmodel", a.SetModel())
	a.server.Add("POST", "/setloras", a.SetLoras())
	a.server.Add("GET", "/currentmodel", a.CurrentModel())
	a.server.Add("GET", "/currentloras", a.CurrentLoras())
	a.server.Add("POST", "/clearmodel", a.ClearModel())
	a.server.Add("POST", "/clearloras", a.ClearLoras())
	a.server.Add("POST", "/download", a.DownloadModel())

	// websocket connection
	a.server.Use("/ws", a.WsUpgrade())
	a.server.Get("/ws/:id", a.Notifications())
}
