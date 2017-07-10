import './util/assertions'
import should from 'should'

import tracer from '../src'
import Span from '../src/span'
import Stream from './util/stream'

const stringify = JSON.stringify

describe('express middleware', () => {
  const express = require('express')
  const request = require('request-promise')

  let stream

  // global open tracing setup
  beforeEach(() => {
    stream = new Stream()
    tracer.init({stream})
  })

  // server vars
  let app, server, port, url, incomingReq

  function startServer (done) {
    // save the request object on all incoming requests for later assertions
    app.all('*', (req, res, next) => {
      incomingReq = req
      res.type('application/json')
      next()
    })

    // responds with 200
    app.get('/hi', (req, res) => {
      setTimeout(function () {
        res.send({data: 'hi'})
      }, 5)
    })

    // always responds with error route
    app.get('/err', (req, res) => {
      res.status(500).send({data: 'this is an error!'})
    })

    server = app.listen(0, () => {
      port = server.address().port
      url = `http://127.0.0.1:${port}`
      done()
    })
  }

  afterEach(() => {
    if (server) { server.close() }
    incomingReq = null
  })

  describe('default name builder', () => {
    // mock app server setup
    beforeEach((done) => {
      app = express()
      app.use(tracer.express())

      // start up app server with routes /hi and /err
      startServer(done)
    })

    describe('when span is started', () => {
      beforeEach(() => {
        return request({method: 'GET', url: `${url}/hi`})
      })
      it('should have expected general middleware span tags', () => {
        let record = stream.getJSON(0)
        record.should.have.tag('span.kind', 'server')
        record.should.have.tag('component', 'ctrace-express')
      })
      it('should have request-based middleware span tags', () => {
        let record = stream.getJSON(0)
        record.should.have.tag('http.remote_addr', '::ffff:127.0.0.1')
        record.should.have.tag('http.method', 'GET')
        record.should.have.tag('http.url', `${url}/hi`)
      })
    })
    describe('when request is successful', () => {
      beforeEach(() => {
        return request({method: 'GET', url: `${url}/hi`})
      })
      it('should assign the name to be in format "[method]-[url]"', () => {
        stream.getJSON(0).should.have.property('operation', 'GET:/hi')
      })

      it('should start span and assign to property `span` of request', () => {
        console.log(typeof incomingReq.traceContext.span)
        should.exist(incomingReq)
        incomingReq.should.have.property('traceContext').which.is.an.Object()
        incomingReq.traceContext.should.have.property('span').which.is.an.instanceOf(Span)

        const rec = stream.getJSON(0)
        let spanContext = incomingReq.traceContext.span.context()
        spanContext.should.containEql({
          'traceId': rec.traceId,
          'spanId': rec.spanId
        })
      })

      it('should close span on request finish', () => {
        const rec = stream.getJSON(0)

        // should have duration field set to int and start shouldn't equal end
        rec.should.have.property('duration').which.is.a.Number().and.is.above(0)

        // 'logs' should be an array of 2 logs the last one being has a Finish-Span event
        rec.should.have.property('logs').which.is.an.Array().with.length(2)
        rec.logs[1].should.have.property('event', 'Finish-Span')
      })

      it('should tag span with status code of response', () => {
        // expect status code tag of 200
        stream.getJSON(0).should.have.tag('http.status_code', 200)
      })
    })
    describe('when an error occurs', () => {
      beforeEach(() => {
        return request({method: 'GET', url: `${url}/err`}).catch((err) => { return err })
      })
      it('sets error status code as a tag', () => {
        stream.getJSON(0).should.have.tag('http.status_code', 500)
      })
      it('should set error boolean as tag on finish span', () => {
        stream.getJSON(0).should.have.tag('error', true)
      })
    })
    describe('when tracing headers are passed', () => {
      let traceIdHeader = '5ab0a6dc1b253333'
      let parentSpanIdHeader = 'eb53262cf9c04b5b'

      beforeEach(() => {
        return request({
          method: 'GET',
          url: `${url}/hi`,
          headers: { 'Ct-Trace-Id': traceIdHeader, 'Ct-Span-Id': parentSpanIdHeader } })
      })
      it('should start span with trace id from extracted header', () => {
        stream.getJSON(0).should.have.property('traceId', traceIdHeader)
      })
      it('should use request id header as parent span id', () => {
        stream.getJSON(0).should.have.property('parentId', parentSpanIdHeader)
      })
      it('should create a new span id from parent', () => {
        const rec = stream.getJSON(0)
        rec.should.have.keys('spanId', 'parentId')
        rec.spanId.should.not.equal(rec.parentId)
      })
    })
    describe('when tracing headers cannot be extracted', () => {
      it('should create the span context fields', () => {
        return request({ method: 'GET', url: `${url}/hi`, headers: { 'Trace-ID': 'incorrect header key' } })
          .then(() => {
            const rec = stream.getJSON(0)
            ; ['traceId', 'spanId'].should.matchEach((val) => {
              rec.should.have.key(val).which.is.a.String().and.is.not.empty()
            }, `expected ${stringify(rec, null, 2)} to have keys traceId and spanId that are non-empty strings`)
          })
      })
    })
  })

  describe('custom name builder', () => {
    // example get operation name from header val
    function customNameBuilder (req) { return req.get('X-Operation-Name') }

    // mock app server setup
    beforeEach((done) => {
      app = express()
      app.use(tracer.express({operationNameBuilder: customNameBuilder}))

      startServer(done)
    })
    describe('when tracing headers are passed', () => {
      let traceIdHeader = '5ab0a6dc1b253333'
      let parentSpanIdHeader = 'eb53262cf9c04b5b'

      beforeEach(() => {
        return request({
          method: 'GET',
          url: `${url}/hi`,
          headers: {
            'X-Correlation-ID': traceIdHeader,
            'X-Request-ID': parentSpanIdHeader,
            'X-Operation-Name': 'SayHello'
          }
        })
      })
      it('should start span with operation name from header', () => {
        stream.getJSON(0).should.have.property('operation', 'SayHello')
      })
    })
  })
})
