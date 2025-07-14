import {Mode} from "./mode.ts"
import {Context} from "./context.ts"
import type {Router, RouteNode, Handler, ResponseInspector} from "./router.ts"

const processResponseInspectors = async (responseInspectors: ResponseInspector[], request: Request, response: Response | Promise<Response>, context: Context): Promise<Response> => {
    const responseObj: Response = (response instanceof Promise) ? await response : response
    for(const responseInspector of responseInspectors) {
        const responseInspectorResponse = responseInspector(request, responseObj, context)
        if (responseInspectorResponse instanceof Promise) {
            await responseInspectorResponse
        }
    }
    return response
}

type Callback = (()=>void) | (()=>Promise<void>)

export class App {
    #router: Router
    #not_found_handler: Handler
    #server_error_handler: Handler
    #server_finished_callbacks: Callback[] = []
    constructor(router: Router, not_found_handler: Handler, server_error_handler: Handler) {
        this.#not_found_handler = not_found_handler
        this.#server_error_handler = server_error_handler
        this.#router = router
    }

    addServerFinishedCallback(callback: Callback) {
        this.#server_finished_callbacks.push(callback)
    }
    
    #processRequest = async (request: Request): Promise<Response> => {
        const context: Context = new Context(request)
        try {
            let nextRouteNode: RouteNode | undefined
            if (request.method == "GET") {
                nextRouteNode = this.#router.get_routes
            } else if (request.method == "HEAD") {
                nextRouteNode = this.#router.head_routes
            } else if (request.method == "POST") {
                nextRouteNode = this.#router.post_routes
            }
            if (!nextRouteNode) {
                // Unsupported method
                console.log(`WARN Called with unsupported method: ${request.method}`)
                return this.#not_found_handler(request,context)
            }
            const pathParts = context.getPathParts()
            pathParts.shift()
            const responseInspectors: ResponseInspector[] = []
            let closestWildcard = undefined
            while(nextRouteNode) {
                // Process inspectors for this node
                for(const inspector of nextRouteNode.inspectors) {
                    if (inspector.requestInspector) {
                        let requestInspectorResponse = inspector.requestInspector(request, context)
                        if (requestInspectorResponse instanceof Promise) {
                            requestInspectorResponse = await requestInspectorResponse
                        }
                        if (requestInspectorResponse.response) {
                            return processResponseInspectors(responseInspectors, request, requestInspectorResponse.response, context)
                        } else if (!requestInspectorResponse.shouldContinue) {
                            console.log(`ERROR Middleware did not provide a response yet shouldContinue was false request pathname: ${context.url.pathname}`)
                            return processResponseInspectors(responseInspectors, request, this.#server_error_handler(request,context), context)
                        }
                    }
                    if (inspector.responseInspector) {
                        responseInspectors.push(inspector.responseInspector)
                    }
                }
                // No more parts, so time to process the route's handler
                if (pathParts.length == 0) {
                    if (nextRouteNode.handler) {
                        return processResponseInspectors(responseInspectors, request, nextRouteNode.handler(request,context), context)
                    }
                    return processResponseInspectors(responseInspectors, request, this.#not_found_handler(request,context), context)
                }
                const pathSegment = pathParts[0]
                pathParts.shift()

                // If there is a splat wildcard child, capture for later
                const wildcardSplitChild = nextRouteNode.childNodes.find(routeNode => (routeNode.isWildcard && routeNode.pathVariable == "*"))
                if (wildcardSplitChild && wildcardSplitChild.handler) {
                    closestWildcard = wildcardSplitChild
                }

                nextRouteNode = nextRouteNode.childNodes.find(routeNode => (routeNode.isWildcard || routeNode.pathSegment == pathSegment))
                if (nextRouteNode && nextRouteNode.isWildcard && nextRouteNode.pathVariable != "*") {
                    context.addPathVariable(nextRouteNode.pathVariable, pathSegment)
                }
            }
            if (closestWildcard && closestWildcard.handler) {
                return processResponseInspectors(responseInspectors, request, closestWildcard.handler(request,context), context)
            }
            return processResponseInspectors(responseInspectors, request, this.#not_found_handler(request,context), context)
        } catch (error) {
            console.log("ERROR", error)
            return this.#server_error_handler(request, context)
        }
    }

    serve(hostname: string, port: number) {
        const abortController = new AbortController()
        const server = Deno.serve({
            port: port,
            hostname: hostname,
            handler: this.#processRequest,
            signal: abortController.signal,
            onListen: function({ port, hostname }) {
                console.log(`Server started at http://${hostname}:${port} on host: ${Deno.hostname()} with run mode: ${Mode.runMode} deno version: ${Deno.version.deno}`)
            },
        })
        server.finished.then(async () => {
            console.log("Server closing")
            for (const callback of this.#server_finished_callbacks) {
                try {
                    await callback()
                } catch (e) {
                    console.log("Caught error during closing", e)
                }
            }
            console.log("Server closed")
            Deno.exit(0)
        })
        const signals: Deno.Signal[] = ["SIGINT", "SIGTERM", "SIGUSR1"]
        signals.forEach(signal => {
            Deno.addSignalListener(signal,
                function() {
                    console.log(`Received ${signal} signal - Starting shutdown`)
                    abortController.abort(`Received ${signal}`)
                }
            )
        })
    }

}

