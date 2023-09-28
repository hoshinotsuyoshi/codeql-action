"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const core = __importStar(require("@actions/core"));
const actions_util_1 = require("./actions-util");
const api_client_1 = require("./api-client");
const autobuild_1 = require("./autobuild");
const configUtils = __importStar(require("./config-utils"));
const logging_1 = require("./logging");
const status_report_1 = require("./status-report");
const util_1 = require("./util");
async function sendCompletedStatusReport(logger, startedAt, allLanguages, failingLanguage, cause) {
    (0, util_1.initializeEnvironment)((0, actions_util_1.getActionVersion)());
    const status = (0, status_report_1.getActionsStatus)(cause, failingLanguage);
    const statusReportBase = await (0, status_report_1.createStatusReportBase)("autobuild", status, startedAt, await (0, util_1.checkDiskUsage)(logger), cause?.message, cause?.stack);
    const statusReport = {
        ...statusReportBase,
        autobuild_languages: allLanguages.join(","),
        autobuild_failure: failingLanguage,
    };
    await (0, status_report_1.sendStatusReport)(statusReport);
}
async function run() {
    const startedAt = new Date();
    const logger = (0, logging_1.getActionsLogger)();
    let currentLanguage = undefined;
    let languages = undefined;
    try {
        if (!(await (0, status_report_1.sendStatusReport)(await (0, status_report_1.createStatusReportBase)("autobuild", "starting", startedAt, await (0, util_1.checkDiskUsage)(logger))))) {
            return;
        }
        const gitHubVersion = await (0, api_client_1.getGitHubVersion)();
        (0, util_1.checkGitHubVersionInRange)(gitHubVersion, logger);
        const config = await configUtils.getConfig((0, actions_util_1.getTemporaryDirectory)(), logger);
        if (config === undefined) {
            throw new Error("Config file could not be found at expected location. Has the 'init' action been called?");
        }
        languages = await (0, autobuild_1.determineAutobuildLanguages)(config, logger);
        if (languages !== undefined) {
            const workingDirectory = (0, actions_util_1.getOptionalInput)("working-directory");
            if (workingDirectory) {
                logger.info(`Changing autobuilder working directory to ${workingDirectory}`);
                process.chdir(workingDirectory);
            }
            for (const language of languages) {
                currentLanguage = language;
                await (0, autobuild_1.runAutobuild)(language, config, logger);
            }
        }
    }
    catch (unwrappedError) {
        const error = (0, util_1.wrapError)(unwrappedError);
        core.setFailed(`We were unable to automatically build your code. Please replace the call to the autobuild action with your custom build steps. ${error.message}`);
        await sendCompletedStatusReport(logger, startedAt, languages ?? [], currentLanguage, error);
        return;
    }
    await sendCompletedStatusReport(logger, startedAt, languages ?? []);
}
async function runWrapper() {
    try {
        await run();
    }
    catch (error) {
        core.setFailed(`autobuild action failed. ${(0, util_1.wrapError)(error).message}`);
    }
}
void runWrapper();
//# sourceMappingURL=autobuild-action.js.map