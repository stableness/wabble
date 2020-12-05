import net from 'net';
import http from 'http';
import { URL } from 'url';
import { once } from 'events';

import {
    option as O,
    either as E,
    taskEither as TE,
    function as F,
} from 'fp-ts';

import * as R from 'ramda';

import * as o from 'rxjs/operators';

import Defer from 'p-defer';

import pino from 'pino';

import {
    httpProxy,
} from '../../src/services/http';

import * as u from '../../src/utils';

import type { Logging } from '../../src/model';
import type { Service, Basic } from '../../src/config';





type Req = http.ClientRequest;
type IcM = http.IncomingMessage;





describe('httpProxy', () => {

    const { auth } = genAuth({ username: 'foo', password: 'bar' });

    test.each([

        { debug: true },
        {  warn: true },

    ])('short for proxy auth in %p', async opts => {

        const service: Service = {
            auth,
            protocol: 'http',
            host: 'localhost',
            port: 0,
        };

        const p = Defer<number>();

        const proxy = httpProxy (service) (genLogging(opts), p.resolve);

        const sub = proxy.subscribe(u.noop);

        const proxyPort = await p.promise;

        const result = await u.run(fetch(

            flushHeaders(
                http.request({
                    host: service.host,
                    port: proxyPort,
                    method: 'GET',
                    path: 'http://example.com',
                }),
            ),

        ));

        sub.unsubscribe();

        expect(E.isLeft(result)).toBe(true);

    });

    test('reject non proxy request', async () => {

        const service: Service = {
            protocol: 'http',
            auth: O.none,
            host: 'localhost',
            port: 0,
        };

        const p = Defer<number>();

        const proxy = httpProxy (service) (genLogging(), p.resolve);

        const sub = proxy.subscribe(u.noop);

        const proxyPort = await p.promise;

        const result = await u.run(fetch(

            flushHeaders(
                http.request({
                    host: service.host,
                    port: proxyPort,
                    method: 'GET',
                    path: '/wat',
                }),
            ),

        ));

        sub.unsubscribe();

        expect(E.isLeft(result)).toBe(true);

    });

});





describe('httpProxy', () => {

    test.each([

        'http://   foo:bar   @   localhost:7000   /hello   ?   c=world',
        'http://                 localhost:7100   /hello   ?   c=world',
        'http://                 localhost:7100   /hello   ?   c=world & e=1',

    ])('%s', async raw => {

        const url = new URL(R.replace(/ /g, '', raw));

        const search = queryFrom(url);
        const { auth, headers } = genAuth(url);
        const server = genServer(url);

        const service: Service = {
            auth,
            protocol: 'http',
            host: url.hostname,
            port: 0,
        };

        const p = Defer<number>();

        const proxy = httpProxy (service) (genLogging(), p.resolve);

        const sub = proxy.pipe(
            o.mergeMap(({ host, port, hook }) => {

                if (search('e') === '1') {
                    return hook();
                }

                return hook(net.connect({ host, port }));

            }),
        ).subscribe(u.noop);

        const proxyPort = await p.promise;

        REQUEST: {

            const result = await u.run(fetch(

                flushHeaders(
                    http.request({
                        headers,
                        host: service.host,
                        port: proxyPort,
                        method: 'GET',
                        path: redirect(url),
                    }),
                ),

            ));

            if (search('e') === '1') {
                expect(E.isLeft(result)).toBe(true);
                break REQUEST;
            }

            expect(result).toStrictEqual(E.right(search('c')));

        }

        CONNECT: {

            const req = flushHeaders(
                http.request({
                    headers,
                    host: service.host,
                    port: proxyPort,
                    method: 'CONNECT',
                    path: R.join(':', [ url.hostname, url.port ]),
                }),
            );

            const result = await u.run(F.pipe(

                u.tryCatchToError(() => once(req, 'connect')),

                TE.map(R.nth(1)),

                TE.chain((socket: net.Socket) => fetch(
                    flushHeaders(
                        http.request(redirect(url), {
                            createConnection: F.constant(socket),
                        }),
                    ),
                )),

            ));

            if (search('e') === '1') {
                expect(E.isLeft(result)).toBe(true);
                break CONNECT;
            }

            expect(result).toStrictEqual(E.right(search('c')));

        }

        sub.unsubscribe();
        server.close();

    });

});





const flushHeaders = R.tap((req: Req) => req.flushHeaders());

const queryFrom =
    (url: URL) =>
        (key: string): string | null =>
            url.searchParams.get(key)
;

function fetch (req: Req) {

    return u.tryCatchToError(async () => {

        const [ res ] = (await once(req, 'response')) as [ IcM ];

        if (res.statusCode !== 200) {
            throw new Error(`code ${ res.statusCode }`);
        }

        const chunks = await u.collectAsyncIterable(res);

        return Buffer.concat(chunks).toString();

    });

}

function genAuth ({ username, password }: Basic) {

    const auth = F.pipe(
        O.some(u.eqBasic({ username, password })),
        O.filter(test => test({ username: '', password: '' }) === false),
    );

    const hasAuth = u.option2B(auth);

    const credentials = u.toBasicCredentials(
        R.join(':', [ username, password ]),
    );

    const headers = {
        ...(hasAuth && { 'Proxy-Authorization': credentials } ),
    };

    return { auth, headers };

}

function redirect ({ hostname, port, pathname }: URL) {
    return `http://${ hostname }:${ port }${ pathname }`;
}

function genServer (url: URL) {

    const search = queryFrom(url);

    return http.createServer((req, res) => {

        if (req.method === 'GET' && req.url === url.pathname) {
            res.writeHead(200);
            res.write(search('c') ?? '');
            res.end();
        }

        req.resume();

    }).listen(+url.port, url.hostname);

}

function genLogging ({ debug = false, warn = false } = {}): Logging {

    return {

        logger: pino({
            base: null,
            prettyPrint: false,
            enabled: false,
        }),

        logLevel: {
            on: {
                warn, debug,
                trace: false, info: false,
                error: false, fatal: false,
                silent: false,
            } as const,
        },

    };

}

