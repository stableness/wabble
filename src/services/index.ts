import {
    function as F,
    readonlyNonEmptyArray as RNEA,
} from 'fp-ts';

import * as Rx from 'rxjs';

import type { Logging } from '../model';
import type { Service, Config } from '../config';

import { httpProxy } from './http';
import { socks5Proxy } from './socks5';





type Proxy = ReturnType<typeof httpProxy | typeof socks5Proxy>;

export type Hook = Rx.ObservedValueOf<ReturnType<Proxy>>['hook'];





export const combine = (logging: Logging) => (services: Config['services']) => {

    const source = F.pipe(
        services,
        RNEA.map(service => box (service) (logging)),
    );

    if (source.length === 1) {
        return RNEA.head(source);
    }

    return Rx.merge(...source);

};





export function box (service: Service) {

    const { protocol } = service;

    if (protocol === 'http') {
        return httpProxy(service);
    }

    if (protocol === 'socks5' as string) {
        return socks5Proxy(service);
    }

    throw new Error(`Non supported protocol [${ protocol }]`);

}

