import * as Restify from 'restify';
import { BotFrameworkAuthentication } from './botFrameworkAuthentication';
import { ConversationsController } from './framework/conversationsController';
import { AttachmentsController } from './framework/attachmentsController';
import { BotStateController } from './framework/botStateController';
import { ConversationsControllerV3 as DirectLineConversationsController } from './directLine/conversationsControllerV3';
import { RestServer } from './restServer';
import { getSettings, addSettingsListener } from './settings';
import { Settings } from '../types/serverSettingsTypes';
import * as log from './log';
import * as Fs from 'fs';
import * as path from 'path';
import * as ngrok from './ngrok';
import { makeLinkMessage } from './log';


/**
 * Communicates with the bot.
 */
export class BotFrameworkService extends RestServer {

    serviceUrl: string;
    inspectUrl: string;
    ngrokPath: string;

    authentication = new BotFrameworkAuthentication();

    constructor() {
        super("emulator");
        ConversationsController.registerRoutes(this, this.authentication);
        AttachmentsController.registerRoutes(this);
        BotStateController.registerRoutes(this, this.authentication);
        DirectLineConversationsController.registerRoutes(this);
        addSettingsListener((settings: Settings) => {
            this.configure(settings);
        });
        this.configure(getSettings());
    }

    /**
     * Applies configuration changes.
     */
    private configure(settings: Settings) {
        let relaunchNgrok = false;

        // Did port change?
        if (this.port !== settings.framework.port) {
            console.log(`restarting ${this.router.name} because ${this.port} !== ${settings.framework.port}`);
            this.restart(settings.framework.port);
            // Respawn ngrok when the port changes
            relaunchNgrok = true;
        }

        // Did ngrok path change?
        if (relaunchNgrok || this.ngrokPath !== settings.framework.ngrokPath) {
            const prevNgrokPath = this.ngrokPath;
            this.ngrokPath = settings.framework.ngrokPath;
            const prevServiceUrl = this.serviceUrl;
            this.serviceUrl = `http://localhost:${this.port}`;
            this.inspectUrl = null;
            const startNgrok = () => {
                // if we have an ngrok path
                if (this.ngrokPath) {
                    // then make it so
                    ngrok.connect({
                        port: this.port,
                        path: this.ngrokPath
                    }, (err, url: string, inspectPort: string) => {
                        if (err) {
                            log.warn(`failed to configure ngrok at ${this.ngrokPath}: ${err.message || err.msg}`);
                        } else {
                            this.inspectUrl = `http://127.0.0.1:${inspectPort}`;
                            this.serviceUrl = url;
                            log.debug(`ngrok listening on: ${url},`, 'inspector url:', log.makeLinkMessage(this.inspectUrl, this.inspectUrl) );
                        }
                    });
                }
            }
            if (this.ngrokPath !== prevNgrokPath) {
                ngrok.kill(() => {
                    startNgrok();
                    return true;
                }) || startNgrok();
            } else {
                ngrok.disconnect(prevServiceUrl, () => {
                    startNgrok();
                });
            }
        }
    }
}