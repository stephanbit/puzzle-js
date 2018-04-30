import md5 from "md5";
import {EventEmitter} from "events";
import {FragmentBFF} from "./fragment";
import {EVENTS, FRAGMENT_RENDER_MODES} from "./enums";
import {IExposeConfig, IGatewayBFFConfiguration, IGatewayConfiguration} from "../types/gateway";
import fetch from "node-fetch";
import {IExposeFragment} from "../types/fragment";
import Timer = NodeJS.Timer;
import {DEFAULT_POLLING_INTERVAL} from "./config";

export class Gateway {
    name: string;
    url: string;

    constructor(gatewayConfig: IGatewayConfiguration) {
        this.name = gatewayConfig.name;
        this.url = gatewayConfig.url;
    }
}


export class GatewayStorefrontInstance extends Gateway {
    events: EventEmitter = new EventEmitter();
    config: IExposeConfig | undefined;
    private intervalId: Timer | null = null;

    constructor(gatewayConfig: IGatewayConfiguration) {
        super(gatewayConfig);

        this.fetch();
    }

    startUpdating(pollingInterval: number = DEFAULT_POLLING_INTERVAL) {
        this.intervalId = setInterval(this.fetch.bind(this), pollingInterval);
    }

    stopUpdating() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
        }
    }

    private fetch() {
        fetch(this.url)
            .then(res => res.json())
            .then(this.update.bind(this))
            .catch(e => {
                //todo error handling
                //console.error(e)
            });
    }

    private update(data: IExposeConfig) {
        if (!this.config) {
            this.config = data;
            this.events.emit(EVENTS.GATEWAY_READY, this);
        } else {
            if (data.hash !== this.config.hash) {
                this.config = data;
                this.events.emit(EVENTS.GATEWAY_UPDATED, this);
            }
        }
    }
}

export class GatewayBFF extends Gateway {
    exposedConfig: IExposeConfig;
    private config: IGatewayBFFConfiguration;
    private fragments: { [name: string]: FragmentBFF } = {};

    constructor(gatewayConfig: IGatewayBFFConfiguration) {
        super(gatewayConfig);
        this.config = gatewayConfig;
        this.exposedConfig = {
            fragments: this.config.fragments.reduce((fragmentList: { [name: string]: IExposeFragment }, fragment) => {
                //todo test cookieler calismiyor
                fragmentList[fragment.name] = {
                    version: fragment.version,
                    render: fragment.render,
                    assets: fragment.versions[fragment.version].assets,
                    dependencies: fragment.versions[fragment.version].dependencies,
                    testCookie: fragment.testCookie,
                };

                this.fragments[fragment.name] = new FragmentBFF(fragment);

                return fragmentList;
            }, {}),
            hash: '', //todo scale edildidiginde degisir
        };

        this.exposedConfig.hash = md5(JSON.stringify(this.exposedConfig));
    }

    async renderFragment(fragmentName: string, renderMode: FRAGMENT_RENDER_MODES = FRAGMENT_RENDER_MODES.PREVIEW, cookieValue?: string) {
        if (this.fragments[fragmentName]) {
            const fragmentContent = await this.fragments[fragmentName].render({}, cookieValue);
            switch (renderMode) {
                case FRAGMENT_RENDER_MODES.STREAM:
                    return JSON.stringify(fragmentContent);
                case FRAGMENT_RENDER_MODES.PREVIEW:
                    return this.wrapFragmentContent(fragmentContent.main, fragmentName);
                default:
                    return JSON.stringify(fragmentContent);
            }
        } else {
            throw new Error(`Failed to find fragment: ${fragmentName}`);
        }
    }

    private wrapFragmentContent(htmlContent: string, fragmentName: string) {
        return `<html><head><title>${this.config.name} - ${fragmentName}</title>${this.config.isMobile && '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />'}</head><body>${htmlContent}</body></html>`;
    }
}
