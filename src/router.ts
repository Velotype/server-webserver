// deno-lint-ignore-file no-explicit-any
import {contentType} from "jsr:@std/media-types@^1.0/content-type"
import {eTag} from "jsr:@std/http@^1.0/etag"

import type {Context} from "./context.ts"
import {Mode} from "./mode.ts"

export class RequestInspectorResponse {
  response: Response | undefined = undefined
  shouldContinue: boolean
  constructor(shouldContinue: boolean, response?: Response) {
    this.shouldContinue = shouldContinue
    this.response = response
  }
}

export type Handler = (request: Request, context: Context) => Response | Promise<Response>
export type RequestInspector = (request: Request, context: Context) => RequestInspectorResponse | Promise<RequestInspectorResponse>
export type ResponseInspector = (request: Request, response: Response, context: Context) => void | Promise<void>
export class Inspector {
  requestInspector: RequestInspector | undefined
  responseInspector: ResponseInspector | undefined
  constructor(requestInspector?: RequestInspector, responseInspector?: ResponseInspector) {
    this.requestInspector = requestInspector
    this.responseInspector = responseInspector
  }
}

export class RouteNode {
    pathSegment: string = ""
    isWildcard: boolean = false
    pathVariable: string = ""
    inspectors: Inspector[] = []
    childNodes: RouteNode[] = []
    handler: Handler | undefined = undefined
    setPathSegment(pathSegment: string) {
        this.pathSegment = pathSegment
    }
    setIsWildcard(isWildcard: boolean, pathVariable?: string) {
        this.isWildcard = isWildcard
        if (pathVariable) {
            this.pathVariable = pathVariable
        }
    }
    addInspector = (inspector: Inspector) => {
        this.inspectors.push(inspector)
    }
    setHandler = (handler: Handler) => {
        if (this.handler) {
            console.log("ERROR RouteNode setHandler called twice for the same route",this)
        } else {
            this.handler = handler
        }
    }
    addChildNode(routeNode: RouteNode) {
        this.childNodes.push(routeNode)
    }
    addPathHandler(pathSegments: string[], handler: Handler) {
        this.addPathPropertyHelper(pathSegments, (node: RouteNode) => {
            node.setHandler(handler)
        })
    }
    addPathInspector(pathSegments: string[], inspector: Inspector) {
        this.addPathPropertyHelper(pathSegments, (node: RouteNode) => {
            node.addInspector(inspector)
        })
    }
    addPathPropertyHelper(pathSegments: string[], setClosure: (node: RouteNode) => void) {
        if (pathSegments.length == 0) {
            setClosure(this)
            return
        }
        const pathSegment = pathSegments[0]
        pathSegments.shift()
        if (pathSegment == "*") {
            if (pathSegments.length > 0) {
                console.log(`ERROR Route validation error, RouteNode with wildcard child has more path segments, pathSegments.length: ${pathSegments.length}`)
            } else {
                const newChild = new RouteNode()
                newChild.setIsWildcard(true, "*")
                setClosure(newChild)
                this.addChildNode(newChild)
            }
        } else if (pathSegment.length > 1 && pathSegment.charAt(0) == ":") {
            const pathVariable = pathSegment.substring(1)
            if (this.childNodes.length > 1) {
                console.log(`ERROR Route validation error, RouteNode with pathVariable child has more than one child, childNodes.length: ${this.childNodes.length}`)
            }
            const child = this.childNodes.find(node => node.isWildcard)
            if (child) {
                if (child.pathVariable != pathVariable) {
                    console.log(`ERROR Route validation error, path variable segments require global consistency current route pathVariable is: ${child.pathVariable} while trying to register: ${pathVariable}`)
                }
                if (pathSegments.length == 0) {
                    setClosure(child)
                } else {
                    child.addPathPropertyHelper(pathSegments, setClosure)
                }
            } else {
                const newChild = new RouteNode()
                newChild.setIsWildcard(true, pathVariable)
                if (pathSegments.length == 0) {
                    setClosure(newChild)
                } else {
                    newChild.addPathPropertyHelper(pathSegments, setClosure)
                }
                this.addChildNode(newChild)
            }
        } else {
            const child = this.childNodes.find(node => node.pathSegment == pathSegment)
            if (child) {
                if (pathSegments.length == 0) {
                    setClosure(child)
                } else {
                    child.addPathPropertyHelper(pathSegments, setClosure)
                }
            } else {
                const newChild = new RouteNode()
                newChild.setPathSegment(pathSegment)
                if (pathSegments.length == 0) {
                    setClosure(newChild)
                } else {
                    newChild.addPathPropertyHelper(pathSegments, setClosure)
                }
                this.addChildNode(newChild)
            }
        }
    }
}

const readTrue = {read: true}
const pathSegmentsFromPath = function(path: string) {
    const pathSegments: string[] = path.split("/")
    pathSegments.shift()
    return pathSegments
}

export class Router {
    get_routes: RouteNode = new RouteNode()
    head_routes: RouteNode = new RouteNode()
    post_routes: RouteNode = new RouteNode()
    not_found_handler: Handler
    server_error_handler: Handler

    constructor(not_found_handler: Handler, server_error_handler: Handler) {
        this.not_found_handler = not_found_handler
        this.server_error_handler = server_error_handler
    }

    static jsonResponse(data: any) {
        const response = new Response(JSON.stringify(data),{status:200})
        response.headers.set("content-type", "text/json; charset=utf-8")
        return response
    }

    get(path: string, handler: Handler) {
        this.get_routes.addPathHandler(pathSegmentsFromPath(path), handler)
    }
    head(path: string, handler: Handler) {
        this.head_routes.addPathHandler(pathSegmentsFromPath(path), handler)
    }
    post(path: string, handler: Handler) {
        this.post_routes.addPathHandler(pathSegmentsFromPath(path), handler)
    }
    addGetInspector(path: string, inspector: Inspector) {
        this.get_routes.addPathInspector(pathSegmentsFromPath(path), inspector)
    }
    addHeadInspector(path: string, inspector: Inspector) {
        this.head_routes.addPathInspector(pathSegmentsFromPath(path), inspector)
    }
    addPostInspector(path: string, inspector: Inspector) {
        this.post_routes.addPathInspector(pathSegmentsFromPath(path), inspector)
    }
    addAllInspector(path: string, inspector: Inspector) {
        this.addGetInspector(path,inspector)
        this.addHeadInspector(path,inspector)
        this.addPostInspector(path,inspector)
    }

    mountFiles(mountDir: string, targetDir: string) {
        console.log(`Mounting target dir: ${targetDir} to mount: ${mountDir}`)
        for (const dirEntry of Deno.readDirSync(targetDir)) {
        if (dirEntry.isFile) {
            this.get(mountDir + dirEntry.name, this.serveFile(targetDir + dirEntry.name))
        } else if (dirEntry.isDirectory) {
            this.mountFiles(mountDir + dirEntry.name + "/", targetDir + dirEntry.name + "/")
        } else if (dirEntry.isSymlink) {
            console.log(`ERROR Attempted to mount a symlink, this is not supported name: ${dirEntry.name}`)
        }
        }
    }
    async mountMemoizedFiles(mountDir: string, targetDir: string) {
        console.log(`Mounting memoized target dir: ${targetDir} to mount: ${mountDir}`)
        for (const dirEntry of Deno.readDirSync(targetDir)) {
        if (dirEntry.isFile) {
            if (Mode.isLocal) {
                console.log(`Serving file directly: ${targetDir + dirEntry.name}`)
                this.get(mountDir + dirEntry.name, this.serveFile(targetDir + dirEntry.name))
            } else {
                console.log(`Serving file memoized: ${targetDir + dirEntry.name}`)
                this.get(mountDir + dirEntry.name, await this.serveMemoizedFile(targetDir + dirEntry.name))
            }
        } else if (dirEntry.isDirectory) {
            this.mountMemoizedFiles(mountDir + dirEntry.name + "/", targetDir + dirEntry.name + "/")
        } else if (dirEntry.isSymlink) {
            console.log(`ERROR Attempted to mount a symlink, this is not supported name: ${dirEntry.name}`)
        }
        }
    }
    serveFile(path: string): Handler {
        console.log(`Loaded file path: ${path}`)
        return async (request: Request, context: Context) => {
            const fileInfo = await Deno.stat(path)
            if (fileInfo.isFile) {
                const file = await Deno.open(path, readTrue)
                const response = new Response(file.readable)
                const ext = path.substring(1 + path.lastIndexOf("."))
                response.headers.set("content-type", contentType(ext) || "application/text")
                return response
            } else {
                return this.not_found_handler(request,context)
            }
        }
    }

    //TODO compress early as part of memoization
    // https://docs.deno.com/runtime/fundamentals/http_server/#automatic-body-compression
    // https://github.com/oakserver/oak/blob/main/send.ts#L167
    //TODO support Cache-Control
    async serveMemoizedFile(path: string) {
        const fileInfo = Deno.statSync(path)
        if (fileInfo.isFile) {
            const ext = path.substring(1 + path.lastIndexOf("."))
            const contentTypeHeader = contentType(ext) || "application/text"
            const file = Deno.openSync(path, readTrue)
            const buf = new Uint8Array(fileInfo.size)
            const numberOfBytesRead = file.readSync(buf)
            const etag = await eTag(buf)
            console.log(`Loaded memoized file path: ${path} bytes: ${numberOfBytesRead} etag: ${etag}`)
            if (numberOfBytesRead == fileInfo.size) {
                return (request: Request, _context: Context) => {
                    const ifNoneMatch = request.headers.get("if-none-match")
                    if (ifNoneMatch && ifNoneMatch == etag) {
                        const response = new Response(null,{status: 304})
                        response.headers.set("content-type", contentTypeHeader)
                        response.headers.set("etag", etag)
                        return response
                    } else {
                        const response = new Response(buf)
                        response.headers.set("content-type", contentTypeHeader)
                        response.headers.set("etag", etag)
                        return response
                    }
                }
            } else {
                return this.server_error_handler
            }
        } else {
            console.log(`ERROR failed to load file, is not a file at path: ${path}`)
            return this.server_error_handler
        }
    }
}
