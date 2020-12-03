import http from 'http';
import { URL } from 'url';

import {
    function as F,
    taskEither as TE,
    readerTaskEither as RTE,
    stateReaderTaskEither as SRTE,
} from 'fp-ts';

import * as R from 'ramda';

import {
    tunnel,
} from '../../src/servers/socks5';

import * as u from '../../src/utils';

import {
    sequence,
    genFlags,
    genAuth,
    genLogging,
    fetchToString,
    flushHeaders,
    redirect,
    readStr,
    Result,
    temp,
    TE_ES,
    Env,
} from './http.spec';





jest.retryTimes(0);





describe('socks5Proxy', () => {

    test.each([

        'socks5://   foo:bar   @   localhost   /hello   ?   c=world           ',
        'socks5://  -foo:bar   @   localhost   /hello   ?   c=world  & a & d  ',
        'socks5://                 localhost   /hello   ?   c=world           ',
        'socks5://                 localhost   /hello   ?   c=world- & e      ',

    ])('%s', async raw => {

        const url = new URL(R.replace(/ /g, '', raw));
        const flags = genFlags(url.searchParams);
        const logging = genLogging({ debug: flags.d });

        const env: Env = { url, flags, logging };

        const invoke = SRTE.evaluate({ proxy: 0, server: 0 });

        await RTE.run(F.pipe(

            invoke(sequence({
                server: temp.server,
                proxy: temp.proxy,
                task: socks5,
            })),

            RTE.map(({ proxy, server, task }) => ({
                task,
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

                error => RTE.fromIO(() => {

                    if (flags.a || flags.e) {
                        return;
                    }

                    expect(error).toBeUndefined();

                }),

                content => RTE.fromIO(() => {

                    expect(content).toBe(readStr(flags.c ?? ''));

                }),

            ),

        ), env);

    });

});





const socks5: Result<TE_ES> = ports => ({ url }) => {

    const { basic: auth } = genAuth(url);

    return TE.of(F.tuple(F.pipe(

        u.socks5Handshake(url.hostname, ports.server),

        tunnel({ auth, host: url.hostname, port: ports.proxy }),

        TE.chain(conn => fetchToString(
            flushHeaders(
                http.request(redirect(url, ports.server), {
                    createConnection: F.constant(conn),
                }),
            ),
        )),

    ), ports));

};

