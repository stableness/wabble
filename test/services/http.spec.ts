import net from 'net';
import http from 'http';
import { once } from 'events';
import { URL, URLSearchParams as SearchParams } from 'url';

import {
    option as O,
    function as F,
    either as E,
    taskEither as TE,
    readerTaskEither as RTE,
    stateReaderTaskEither as SRTE,
} from 'fp-ts';

import * as Rx from 'rxjs';

import * as R from 'ramda';

import Defer from 'p-defer';

import {
    box,
} from '../../src/services/index.js';

import {
    httpProxy,
} from '../../src/services/http.js';

import * as u from '../../src/utils/index.js';

import type { Logging } from '../../src/model.js';
import type { Service, Basic } from '../../src/config.js';

import { genLogging } from './index.spec.js';





type Req = http.ClientRequest;
type IcM = http.IncomingMessage;

type Closing = { close: () => void };

type Ports = Readonly<Record<'proxy' | 'server', number>>;

export type Result <T> = SRTE.StateReaderTaskEither<Ports, Env, Error, T>;

export type TE_ES = TE.TaskEither<Error, string>;

export type Env = Readonly<{
    url: URL;
    logging: Logging;
    flags: ReturnType<typeof genFlags>;
}>;





jest.retryTimes(0);





describe('httpProxy', () => {

    test.each([

        { debug: true },
        {  warn: true },

    ])('short for proxy auth in %p', async opts => {

        const { auth } = genAuth({ username: 'foo', password: 'bar' });

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

        const result = await u.run(fetchToString(

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

        const result = await u.run(fetchToString(

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

        'http://   foo:bar   @   localhost   /hello   ?   c=world             ',
        'http://  -foo:bar   @   localhost   /hello   ?   c=world  & a & d    ',
        'http://                 localhost   /hello   ?   c=world  & p        ',
        'http://                 localhost   /hello   ?   c=world             ',
        'http://                 localhost   /hello   ?   c=world- & e        ',

    ])('%s', async raw => {

        const env = genEnv(raw);

        const invoke = SRTE.evaluate({ proxy: 0, server: 0 });

        await u.run(R.applyTo(env, F.pipe(

            invoke(F.pipe(
                SRTE.of({}) as never,
                SRTE.apS('server', temp.server),
                SRTE.apS('proxy', temp.proxy),
                SRTE.apS('REQUEST', temp.REQUEST),
                SRTE.apS('CONNECT', temp.CONNECT),
                SRTE.apS('CONNECT_H', temp.CONNECT_HEAD),
            )),

            RTE.map(({ proxy, server, REQUEST, CONNECT, CONNECT_H }) => ({
                task: TE.sequenceArray([ REQUEST, CONNECT, CONNECT_H ]),
                close () {
                    proxy.close();
                    server.close();
                },
            })),

            RTE.chain(({ close, task }) => RTE.bracket(
                RTE.of({}),
                F.constant(RTE.fromTaskEither(task)),
                F.constant(RTE.fromIO(close)),
            )),

            RTE.fold(

                error => RTE.asks(({ flags }) => {

                    if (flags.a || flags.e) {
                        return;
                    }

                    expect(error).toBeUndefined();

                }),

                ([ request, connect, connectH ]) => RTE.asks(({ flags }) => {

                    const content = readStr(flags.c ?? '');

                    expect(request).toBe(content);
                    expect(connect).toBe(content);
                    expect(connectH).toBe(content);

                }),

            ),

        )));

    });

});





export const flushHeaders = R.tap((req: Req) => req.flushHeaders());

export const queryFrom =
    (url: URL) =>
        (key: string): string | null =>
            url.searchParams.get(key)
;

export const readStr: u.Fn<string> = R.cond([
    [ R.startsWith('-'), R.tail ],
    [   R.endsWith('-'), R.init ],
    [ R.T, R.identity ],
]);

export function fetchToString (req: Req) {

    return u.tryCatchToError(async () => {

        const [ res ] = (await once(req, 'response')) as [ IcM ];

        if (res.statusCode !== 200) {
            throw new Error(`code ${ res.statusCode }`);
        }

        const chunks = await u.collectAsyncIterable(res);

        return Buffer.concat(chunks).toString();

    });

}

export function genAuth ({ username, password }: Basic) {

    const auth = F.pipe(
        O.some(u.eqBasic({ username, password })),
        O.filter(test => test({ username: '', password: '' }) === false),
    );

    const basic = O.chain (F.constant(O.some({ username, password }))) (auth);

    const hasAuth = u.option2B(auth);

    const credentials = u.toBasicCredentials(
        R.join(':', [ username, password ]),
    );

    const headers = {
        ...(hasAuth && { 'Proxy-Authorization': credentials } ),
    };

    return { auth, basic, headers };

}

export function redirect (url: URL, optionPort?: number) {
    const { hostname, port, pathname } = url;
    return `http://${ hostname }:${ optionPort ?? port }${ pathname }`;
}

export function genFlags (search: SearchParams) {

    const a = search.has('a');
    const e = search.has('e');
    const d = search.has('d');
    const p = search.has('p');
    const c = search.get('c');

    return { a, e, d, c, p };

}

export function genEnv (raw: string): Env {

    const url = new URL(R.replace(/ /g, '', raw));
    const flags = genFlags(url.searchParams);
    const logging = genLogging({ debug: flags.d });

    return { url, flags, logging };

}

export const temp = u.run(function () {

    const REQUEST: Result<TE_ES> = ports => ({ url, flags }) => {

        const { headers } = genAuth(url);

        const p = flags.p ? '/' : '';

        return TE.of(F.tuple(fetchToString(
            flushHeaders(
                http.request({
                    headers,
                    host: url.hostname,
                    port: ports.proxy,
                    method: 'GET',
                    path: p + redirect(url, ports.server),
                }),
            ),
        ), ports));

    };



    const CONNECT: Result<TE_ES> = ports => ({ url }) => {

        const { headers } = genAuth(url);

        return TE.of(F.tuple(F.pipe(

            u.tryCatchToError(() => {

                const req = flushHeaders(
                    http.request({
                        headers,
                        host: url.hostname,
                        port: ports.proxy,
                        method: 'CONNECT',
                        path: R.join(':', [ url.hostname, ports.server ]),
                    }),
                );

                return once(req, 'connect');

            }),

            TE.map(R.nth(1)),

            TE.chain((conn: net.Socket) => fetchToString(
                flushHeaders(
                    http.request(redirect(url, ports.server), {
                        createConnection: F.constant(conn),
                    }),
                ),
            )),

        ), ports));

    };



    const CONNECT_HEAD: Result<TE_ES> = ports => ({ url }) => {

        const { headers } = genAuth(url);

        return TE.of(F.tuple(F.pipe(

            u.tryCatchToError(async () => {

                const req = http.request({
                    headers,
                    host: url.hostname,
                    port: ports.proxy,
                    method: 'CONNECT',
                    path: R.join(':', [ url.hostname, ports.server ]),
                });

                req.write(u.headerJoin([
                    `GET ${ url.pathname } HTTP/1.1`,
                    `Host: ${ req.path }`,
                    'Connection: close',
                ]));

                await once(req, 'connect');

                return F.pipe(
                    await u.collectAsyncIterable(req.socket),
                    Buffer.concat,
                    R.toString,
                    R.split('\r\n\r\n'),
                    R.last,
                ) as string;

            }),

        ), ports));

    };



    const proxy: Result<Closing> = ports => ({ url, logging, flags }) => {

        const trimAuth: typeof genAuth = R.o(
            genAuth,
            R.evolve({
                username: readStr,
                password: readStr,
            }),
        );

        const { auth } = trimAuth(url);
        const update = R.assoc('proxy', R.__, ports);

        const service: Service = {
            auth,
            protocol: R.init(url.protocol) as Service['protocol'],
            host: url.hostname,
            port: ports.proxy,
        };

        return u.tryCatchToError(async () => {

            const { resolve, promise } = Defer<number>();

            const source = box (service) (logging, resolve);

            const dispose = new Rx.Subject<boolean>();

            const close = R.once(() => {
                dispose.next(true);
            });

            source.pipe(

                Rx.mergeMap(({ host, port, hook, abort }) => {

                    if (flags.e) {
                        abort();
                        return Rx.EMPTY;
                    }

                    return hook(net.connect({ host, port }));

                }),

                Rx.takeUntil(dispose),

            ).subscribe({ error: close });

            return F.tuple({ close }, update(await promise));

        });

    };



    const server: Result<Closing> = ports => ({ url, flags }) => {

        const update = R.assoc('server', R.__, ports);

        return TE.fromTask(async () => {

            const { resolve, promise } = Defer<number>();

            const ser = http.createServer((req, res) => {

                if (req.method === 'GET' && req.url === url.pathname) {
                    res.setHeader('Content-Length', flags.c?.length ?? 0);
                    res.write(flags.c ?? '');
                } else {
                    res.writeHead(404);
                }

                res.end();
                req.resume();

            });

            ser.listen({ port: ports.server, host: url.hostname }, () => {

                const address = ser.address() ?? '';
                resolve(typeof address === 'string' ? 0 : address.port);

                ser.unref();

            });

            return F.tuple(ser, update(await promise));

        });

    };



    return { proxy, server, REQUEST, CONNECT, CONNECT_HEAD };

});

