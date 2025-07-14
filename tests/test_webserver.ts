
import { App, Router, type Handler, type Context } from "../src/index.ts"

const not_found_handler = function() {
    const response = new Response("<!DOCTYPE html><html><body>Not Found</body></html>", {status: 404})
    response.headers.set("content-type", "text/html; charset=utf-8")
    return response
}
const server_error_handler = function() {
    return new Response("Internal Server Error", {status: 500})
}

const router: Router = new Router(not_found_handler, server_error_handler)
await router.mountMemoizedFiles("/static/", `${Deno.cwd()}/tests/static/`)

const examplePageHandler: Handler = function(_request: Request, _context: Context) {
    const response = new Response("Hello webserver")
    response.headers.set("content-type", "text/html; charset=utf-8")
    return response
}
router.get("/hello", examplePageHandler)

const app = new App(router, not_found_handler, server_error_handler)

app.serve("127.0.0.1", 3000)
