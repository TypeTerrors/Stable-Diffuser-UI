package services

import (
	"be/config"
	"be/internal/dependencies"
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
}

func NewApi(rpc *dependencies.Rpc, config config.ApiConfig) *Api {
	if config.AllowedOrigins == "" {
		config.AllowedOrigins = "*"
	}

	return &Api{
		server:         fiber.New(),
		rpc:            rpc,
		port:           config.Port,
		allowedOrigins: config.AllowedOrigins,
	}
}

func (a *Api) Start() {

	allowCredentials := a.allowedOrigins != "*"

	a.server.Use(cors.New(cors.Config{
		AllowOrigins:     a.allowedOrigins,
		AllowCredentials: allowCredentials,
		AllowMethods:     "GET,POST,OPTIONS",
		AllowHeaders:     "Content-Type,Authorization,Accept,Origin",
	}))

	a.addRoutes()

	log.Fatal(a.server.Listen(fmt.Sprint(":", a.port)))
}

func (a *Api) addRoutes() {
	a.server.Add("GET", "/health", a.Health())
	a.server.Add("POST", "/generateimage", a.GenerateImage())
	a.server.Add("GET", "/models", a.ListModels())
	a.server.Add("GET", "/loras", a.ListLoras())
	a.server.Add("POST", "/setmodel", a.SetModel())
	a.server.Add("POST", "/setloras", a.SetLoras())
	a.server.Add("GET", "/currentmodel", a.CurrentModel())
	a.server.Add("GET", "/currentloras", a.CurrentLoras())
	a.server.Add("POST", "/clearmodel", a.ClearModel())
	a.server.Add("POST", "/clearloras", a.ClearLoras())

	// websocket connection
	a.server.Use("/ws", a.WsUpgrade())
	a.server.Get("/ws/:id", a.Notifications())
}
