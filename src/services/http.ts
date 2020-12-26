import type { Socket } from 'net';
import { URL } from 'url';
import { Duplex, PassThrough, Readable } from 'stream';

import http, { IncomingMessage, ServerResponse } from 'http';

import { bind } from 'proxy-bind';

import {
    io as IO,
    option as O,
    either as E,
    function as F,
} from 'fp-ts';

import * as R from 'ramda';

import * as Rx from 'rxjs';
import * as o from 'rxjs/operators';

import type { Logging } from '../model';
import type { Service } from '../config';
import * as u from '../utils';

import { do_not_require } from './utils';





type Knock = Request | Connect;

type Request = ReturnType<typeof mapRequest>;
type Connect = ReturnType<typeof mapConnect>;





/* eslint-disable indent */

export const httpProxy =
    ({ port, host, auth }: Service) =>
        (logging: Logging, cb: u.Fn<number, void> = u.noop) => {

    const { logLevel, logger } = logging;

    const is_admission_free = do_not_require(auth);

    const conn$ = new Rx.Observable<Knock>(subject => {

        const { next, error, complete } = bind(subject);

        function onRequest (
                request: IncomingMessage,
                response: ServerResponse,
        ) {

            if (`${ request.url }`.startsWith('http') === false) {
                return response.writeHead(400).end();
            }

            next(mapRequest(request, response));

        }

        function onConnect (
                request: IncomingMessage,
                socket: Socket,
                head: Buffer,
        ) {
            next(mapConnect(request, socket, head));
        }

        function onListening () {
            const address = server.address() ?? '';
            cb(typeof address === 'string' ? 0 : address.port);
        }

        const server = http.createServer()

            .addListener('request', onRequest)
            .addListener('connect', onConnect)
            .addListener('listening', onListening)
            .addListener('error', error)
            .addListener('close', complete)

            .listen(port, host)

        ;

        return function () {

            server

                .removeListener('request', onRequest)
                .removeListener('connect', onConnect)
                .removeListener('listening', onListening)
                .removeListener('error', error)
                .removeListener('close', complete)

                .close()

            ;

        };

    }).pipe(

        o.filter(({ request: { socket, headers }, url: { hostname } }) => {

            // istanbul ignore next
            if (hostname.length < 1) {
                socket.end(u.headerJoin([ 'HTTP/1.1 400' ]));
                return false;
            }

            if (is_admission_free) {
                return true;
            }

            const info = F.pipe(
                u.basicInfo.proxyAuth(headers),
                O.map(({ name: username, pass: password }) => {
                    return { username, password };
                }),
            );

            return F.pipe(

                O.ap(info)(auth),

                O.filter(F.identity),

                E.fromOption(CONST_PROXY_AUTHENTICATION),

                E.mapLeft(msg => {

                    socket.end(msg);

                    if (logLevel.on.debug) {

                        logger.debug({
                            msg: 'PROXY_AUTH_FAILED',
                            auth: O.toNullable(info),
                            header: headers['proxy-authorization'],
                        });

                    } else if (logLevel.on.warn) {

                        logger.warn('PROXY_AUTH_FAILED');

                    }

                }),

                u.either2B,

            );

        }),

        o.share(),

    );

    return Rx.merge(
        requestOn(conn$),
        connectOn(conn$),
    );

};

/* eslint-enable indent */





export const requestOn = Rx.pipe(

    o.filter<Knock, Request>(
        (item): item is Request => item.type === 'request',
    ),

    o.map(({ request, response, url }) => ({

        host: url.hostname,
        port: u.portNormalize(url),

        async hook (...duplex: NodeJS.ReadWriteStream[]) {

            const { connection: socket = null } = response;

            // istanbul ignore next
            if (socket == null) {
                return;
            }

            if (R.isEmpty(duplex)) {
                socket.resume();
                return response.writeHead(503).end();
            }

            const { method = 'GET', headers } = request;

            const source = new PassThrough({
                destroy: manualDestroy,
            }) as unknown as Socket;

            const encoder = new http.OutgoingMessage();

            encoder.useChunkedEncodingByDefault = !bodilessMethod(method);
            encoder.connection = source;

            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            source._httpMessage = encoder;

            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call
            encoder._storeHeader(
                `${ method } ${ url.pathname } HTTP/1.1\r\n`,
                omitHopHeaders(headers),
            );

            encoder.flushHeaders();



            await Promise.all([

                u.pump(request, encoder),
                u.pump(source, ...duplex, socket),

            ]).finally(/*#__NOINLINE__*/ destroyArray([

                request,
                response,
                encoder,

            ]));

        },

    })),

);





export const connectOn = Rx.pipe(

    o.filter<Knock, Connect>(
        (item): item is Connect => item.type === 'connect',
    ),

    o.map(({ socket, url, head }) => ({

        host: url.hostname,
        port: u.portNormalize(url),

        async hook (...duplex: NodeJS.ReadWriteStream[]) {

            if (R.isEmpty(duplex)) {
                socket.resume();
                return socket.end(u.headerJoin([ 'HTTP/1.0 503' ]));
            }

            if (head.length > 0) {
                socket.unshift(head);
            }

            socket.write(u.headerJoin([ 'HTTP/1.0 200' ]));

            await u.pump(socket, ...duplex, socket);

        },

    })),

);





export function mapRequest (
        request: IncomingMessage,
        response: ServerResponse,
) {
    return {
        type: 'request' as const,
        url: new URL(request.url ?? ''),
        request,
        response,
    };
}





export function mapConnect (
        request: IncomingMessage,
        socket: Socket,
        head: Buffer,
) {
    return {
        type: 'connect' as const,
        url: new URL(`http://${ request.url }`),
        request,
        socket,
        head,
    };
}





export const omitHopHeaders = R.omit([
    'proxy-authorization',
    'proxy-connection',
    'transfer-encoding',
    'connection',
    'keep-alive',
    'upgrade',
    'trailer',
    'te',
]);





const bodilessMethod: u.Fn<string, boolean> = method => [

    'GET',
    'HEAD',
    'DELETE',
    'OPTIONS',
    'TRACE',
    'CONNECT',

].includes(method.toUpperCase());





const CONST_PROXY_AUTHENTICATION = F.constant(u.headerJoin([
    'HTTP/1.1 407 Proxy Authentication Required',
    'Proxy-Authenticate: Basic realm="proxy auth please"',
]));





const manualDestroy = function (this: Duplex) {
    this.destroyed = true;
    this.emit('close');
};





type Item = Pick<Readable, 'destroyed' | 'destroy'>;

const destroyArray = /*#__NOINLINE__*/ IO.traverseArray((item: Item) => () => {
    if (item.destroyed !== true) {
        item.destroy();
    }
});

