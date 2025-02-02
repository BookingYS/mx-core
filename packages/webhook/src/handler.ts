import assert from 'assert'
import { createHmac, timingSafeEqual } from 'crypto'
import { EventEmitter } from 'events'
import type { IncomingMessage, ServerResponse } from 'http'
import type { BusinessEvents } from './event.enum'
import type { ExtendedEventEmitter } from './types'

interface CreateHandlerOptions {
  secret: string
  events?: 'all' | BusinessEvents[]
}

type Handler = {
  (req: IncomingMessage, res: ServerResponse): void
} & {
  emitter: ExtendedEventEmitter
}

export const createHandler = (options: CreateHandlerOptions): Handler => {
  const { secret } = options

  const handler: Handler = async function (req, res) {
    try {
      const signature = req.headers['x-webhook-signature']
      assert(
        typeof signature === 'string',
        'X-Webhook-Signature must be string',
      )
      const event = req.headers['x-webhook-event']
      const signature256 = req.headers['x-webhook-signature256']
      assert(
        typeof signature256 === 'string',
        'X-Webhook-Signature256 must be string',
      )

      const obj = (req as any).body || (await parseJSONFromRequest(req))
      const stringifyPayload = JSON.stringify(obj)
      const isValid =
        verifyWebhook(secret, stringifyPayload, signature256 as string) &&
        verifyWebhookSha1(secret, stringifyPayload, signature as string)
      if (isValid) {
        if (event === 'health_check') {
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: 1 }))
          return
        }

        handler.emitter.emit(event as BusinessEvents, obj)
        handler.emitter.emit('*', {
          type: event,
          payload: obj,
        })
        res.statusCode = 200
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ ok: 1 }))
      } else {
        console.error('revice a invalidate webhook payload', req.headers)
        handler.emitter.emit('error', new Error('invalidate signature'))

        res.statusCode = 400
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ ok: 0, message: 'Invalid Signature' }))
      }
    } catch (err) {
      res.statusCode = 500
      res.end(JSON.stringify({ ok: 0, message: err.message }))
    }
  }

  handler.emitter = new EventEmitter()
  return handler
}

function parseJSONFromRequest(req: IncomingMessage) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(body))
      } catch (err) {
        reject(err)
      }
    })
  })
}

export function verifyWebhook(
  secret: string,
  payload: string,
  receivedSignature: string,
): boolean {
  const hmac = createHmac('sha256', secret)
  hmac.update(payload)

  // 安全地比较两个签名，以防止时间攻击
  return timingSafeEqual(
    Buffer.from(receivedSignature),
    Buffer.from(hmac.digest('hex')),
  )
}

export function verifyWebhookSha1(
  secret: string,
  payload: string,
  receivedSignature: string,
): boolean {
  const hmac = createHmac('sha1', secret)
  hmac.update(payload)

  // 安全地比较两个签名，以防止时间攻击
  return timingSafeEqual(
    Buffer.from(receivedSignature),
    Buffer.from(hmac.digest('hex')),
  )
}
