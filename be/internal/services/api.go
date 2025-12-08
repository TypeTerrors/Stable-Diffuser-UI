package services

import (
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

func NewApi(port string, rpc *dependencies.Rpc, allowedOrigins string) *Api {
	if allowedOrigins == "" {
		allowedOrigins = "*"
	}
	return &Api{
		server:         fiber.New(),
		rpc:            rpc,
		port:           port,
		allowedOrigins: allowedOrigins,
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
}
