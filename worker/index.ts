interface Env {
  ASSETS: {
    fetch(request: Request): Promise<Response>
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const response = await env.ASSETS.fetch(request)
    if (!response.headers.get('content-type')?.includes('text/html')) return response

    const imageUrl = new URL('/og.png', request.url).href
    const headers = new Headers(response.headers)
    headers.delete('content-length')
    return new Response((await response.text()).replaceAll('__OG_IMAGE_URL__', imageUrl), {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  },
}
