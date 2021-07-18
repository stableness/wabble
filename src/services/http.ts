import type { Socket } from 'net';
import { URL } from 'url';
import { Duplex, PassThrough } from 'stream';

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

import type { Logging } from '../model.js';
import type { Service } from '../config.js';
import * as u from '../utils/index.js';

import { do_not_require } from './utils.js';





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

            const { url = '' } = request;

            if (url.startsWith('/http://') === true) {
                request.url = R.tail(url);
            }

            if (request.url?.startsWith('http://') === false) {
                response.writeHead(400).end();
                return;
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

        Rx.filter(({ request: { socket, headers }, url: { hostname } }) => {

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

        Rx.share(),

    );

    return Rx.merge(
        requestOn(conn$),
        connectOn(conn$),
    );

};

/* eslint-enable indent */





export const requestOn = Rx.pipe(

    Rx.filter<Knock, Request>(
        (item): item is Request => item.type === 'request',
    ),

    Rx.map(({ request, response, url }) => ({

        host: url.hostname,
        port: u.portNormalize(url),

        async hook (...duplex: NodeJS.ReadWriteStream[]) {

            const { socket } = response;

            // istanbul ignore next
            if (socket == null) {
                return;
            }

            const source = new PassThrough();

            const sink = new Duplex({
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                readable: false,
                read: u.noop,
                write: source.write.bind(source),
                destroy: manualDestroy,
            });

            const { method, headers, url: reqURL = '' } = request;

            const encoder = http.request(reqURL, {
                method,
                headers: omitHopHeaders(headers),
                createConnection: F.constant(sink as Socket),
            });

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

        abort: R.once(() => {
            response.socket?.resume();
            response.writeHead(503).end();
        }),

    })),

);





export const connectOn = Rx.pipe(

    Rx.filter<Knock, Connect>(
        (item): item is Connect => item.type === 'connect',
    ),

    Rx.map(({ socket, url, head }) => ({

        host: url.hostname,
        port: u.portNormalize(url),

        async hook (...duplex: NodeJS.ReadWriteStream[]) {

            if (head.length > 0) {
                socket.unshift(head);
            }

            socket.write(u.headerJoin([ 'HTTP/1.0 200' ]));

            await u.pump(socket, ...duplex, socket);

        },

        abort: R.once(() => {
            socket.resume();
            socket.end(u.headerJoin([ 'HTTP/1.0 503' ]));
        }),

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





const CONST_PROXY_AUTHENTICATION = F.constant(u.headerJoin([
    'HTTP/1.1 407 Proxy Authentication Required',
    'Proxy-Authenticate: Basic realm="proxy auth please"',
]));





const manualDestroy = function (this: Duplex) {
    this.destroyed = true;
    this.emit('close');
};





type Item = {
    readonly destroyed: boolean;
    destroy (): unknown;
};

const destroyArray = /*#__NOINLINE__*/ IO.traverseArray((item: Item) => () => {
    if (item.destroyed !== true) {
        item.destroy();
    }
});

