import * as opentracing from 'opentracing'
import GlobalTracer from './globalTracer'
import express from './middleware/express'
import request from './middleware/request'

const tracer = Object.assign(new GlobalTracer(), opentracing)
tracer.express = express
tracer.request = request

function logFn (level) {
  return function log (ctx, event, data) {
    if (level === 'debug') {
      data = Object.assign({ debug: true }, data)
    } else if (level === 'error') {
      data = Object.assign({ error: true }, data)
    }
    ctx.span.log(Object.assign({ event: event , level: level}, data))
  }
}
tracer.debug = logFn('debug')
tracer.info = logFn('info')
tracer.warn = logFn('warn')
tracer.error = logFn('error')

export default tracer
