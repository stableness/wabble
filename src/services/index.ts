import * as Rx from 'rxjs';

import {
    readonlyNonEmptyArray as RNEA,
} from 'fp-ts';

import type { Logging } from '../model';
import type { Service } from '../config';

import { httpProxy } from './http';
import { socks5Proxy } from './socks5';





type Proxy = ReturnType<typeof httpProxy> | ReturnType<typeof socks5Proxy>;

export type Hook = Rx.ObservedValueOf<ReturnType<Proxy>>['hook'];





export const combine = (logging: Logging) => (services: RNEA.ReadonlyNonEmptyArray<Service>) => {

    const { length, 0: head } = services;

    if (length === 1) {
        return box (head) (logging);
    }

    return Rx.merge(...services.map(service => box (service) (logging)));

};





export function box (service: Service) {

    const { protocol } = service;

    if (protocol === 'http') {
        return httpProxy(service);
    }

    if (protocol === 'socks5') {
        return socks5Proxy(service);
    }

    throw new Error(`Non supported protocol [${ protocol }]`);

}

