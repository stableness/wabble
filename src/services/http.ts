import type { Socket } from 'net';
import { URL } from 'url';
import { Duplex, PassThrough } from 'stream';

import http from 'http';
import type { IncomingMessage, ServerResponse } from 'http';

import { bind, mirror } from 'proxy-bind';

import { option as O, either as E, function as F } from 'fp-ts';

import * as R from 'ramda';

import * as Rx from 'rxjs';
import * as o from 'rxjs/operators';

import type { Logging } from '../model';
import type { Service } from '../config';
import * as u from '../utils';





type Knock = Request | Connect;

type Request = ReturnType<typeof mapRequest>;
type Connect = ReturnType<typeof mapConnect>;





export const httpProxy = ({ port, host, auth }: Service) => (logging: Logging) => {

    const { logLevel, logger } = logging;

    const authRequired = u.option2B(auth);

    const conn$ = new Rx.Observable<Knock>(subject => {

        const { next, error, complete } = bind(subject);

        function onRequest (request: IncomingMessage, response: ServerResponse) {

            if (`${ request.url }`.startsWith('http') === false) {
                return response.writeHead(400).end();
            }

            next(mapRequest(request, response));

        }

        function onConnect (request: IncomingMessage, socket: Socket, head: Buffer) {
            next(mapConnect(request, socket, head));
        }

        const server = http.createServer()

            .addListener('request', onRequest)
            .addListener('connect', onConnect)
            .addListener('error', error)
            .addListener('close', complete)

            .listen(port, host)

        ;

        return function () {

            server

                .removeListener('request', onRequest)
                .removeListener('connect', onConnect)
                .removeListener('error', error)
                .removeListener('close', complete)

                .close()

            ;

        };

    }).pipe(

        o.filter(({ request: { socket, headers }, url: { hostname } }) => {

            if (hostname.length < 1) {
                socket.end(u.headerJoin([ 'HTTP/1.1 400' ]));
                return false;
            }

            if (authRequired === false) {
                return true;
            }

            const info = F.pipe(
                u.basicInfo.proxyAuth(headers),
                O.map(({ name: username, pass: password }) => ({ username, password })),
            );

            return F.pipe(

                O.ap(info)(auth),

                O.filter(F.identity),

                E.fromOption(F.constant(u.headerJoin([
                    'HTTP/1.1 407 Proxy Authentication Required',
                    'Proxy-Authenticate: Basic realm="proxy auth please"',
                ]))),

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





export const requestOn = Rx.pipe(

    o.filter<Knock, Request>((item): item is Request => item.type === 'request'),

    o.map(({ request, response, url }) => ({

        host: url.hostname,
        port: u.portNormalize(url),

        async hook (...duplex: NodeJS.ReadWriteStream[]) {

            const { connection: socket } = response;

            if (socket == null) {
                return;
            }

            if (R.isEmpty(duplex)) {
                u.mountErrOf(socket);
                return response.writeHead(503).end();
            }

            const { noop: read } = u;
            const [ source, { write } ] = mirror(new PassThrough());
            const [ sink, { destroy } ] = mirror(new Duplex({ read, write }));

            const { method, headers, url: reqURL = '' } = request;

            const mock = http.request(reqURL, {
                method,
                headers: omitHopHeaders(headers),
                createConnection: R.always(sink as Socket),
            });

            await Promise.all([
                u.pump(request, mock).finally(destroy),
                u.pump(source, ...duplex, socket),
            ]);

        },

    })),

);





export const connectOn = Rx.pipe(

    o.filter<Knock, Connect>((item): item is Connect => item.type === 'connect'),

    o.map(({ socket, url }) => ({

        host: url.hostname,
        port: u.portNormalize(url),

        async hook (...duplex: NodeJS.ReadWriteStream[]) {

            if (R.isEmpty(duplex)) {
                u.mountErrOf(socket);
                return socket.end(u.headerJoin([ 'HTTP/1.0 503' ]));
            }

            socket.write(u.headerJoin([ 'HTTP/1.0 200' ]));

            await u.pump(socket, ...duplex, socket);

        },

    })),

);





export function mapRequest (request: IncomingMessage, response: ServerResponse) {
    return {
        type: 'request' as const,
        url: mapURL(request.url || ''),
        request,
        response,
    };
}





export function mapConnect (request: IncomingMessage, socket: Socket, head: Buffer) {
    return {
        type: 'connect' as const,
        url: mapURL(`http://${ request.url }`),
        request,
        socket,
        head,
    };
}





export const mapURL = R.memoizeWith(
    R.identity,
    R.constructN(1, URL) as u.Fn<string, URL>,
);





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

