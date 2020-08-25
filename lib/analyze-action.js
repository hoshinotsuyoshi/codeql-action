"use strict";
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const core = __importStar(require("@actions/core"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const codeql_1 = require("./codeql");
const configUtils = __importStar(require("./config-utils"));
const languages_1 = require("./languages");
const logging_1 = require("./logging");
const repository_1 = require("./repository");
const sharedEnv = __importStar(require("./shared-environment"));
const upload_lib = __importStar(require("./upload-lib"));
const util = __importStar(require("./util"));
async function sendStatusReport(startedAt, queriesStats, uploadStats, error) {
    var _a, _b, _c;
    const status = ((_a = queriesStats) === null || _a === void 0 ? void 0 : _a.analyze_failure_language) !== undefined || error !== undefined ? 'failure' : 'success';
    const statusReportBase = await util.createStatusReportBase('finish', status, startedAt, (_b = error) === null || _b === void 0 ? void 0 : _b.message, (_c = error) === null || _c === void 0 ? void 0 : _c.stack);
    const statusReport = {
        ...statusReportBase,
        ...(queriesStats || {}),
        ...(uploadStats || {}),
    };
    await util.sendStatusReport(statusReport);
}
async function createdDBForScannedLanguages(config) {
    const codeql = codeql_1.getCodeQL(config.codeQLCmd);
    for (const language of config.languages) {
        if (languages_1.isScannedLanguage(language)) {
            core.startGroup('Extracting ' + language);
            await codeql.extractScannedLanguage(util.getCodeQLDatabasePath(config.tempDir, language), language);
            core.endGroup();
        }
    }
}
async function finalizeDatabaseCreation(config) {
    await createdDBForScannedLanguages(config);
    const codeql = codeql_1.getCodeQL(config.codeQLCmd);
    for (const language of config.languages) {
        core.startGroup('Finalizing ' + language);
        await codeql.finalizeDatabase(util.getCodeQLDatabasePath(config.tempDir, language));
        core.endGroup();
    }
}
// Runs queries and creates sarif files in the given folder
async function runQueries(sarifFolder, config) {
    const codeql = codeql_1.getCodeQL(config.codeQLCmd);
    for (let language of config.languages) {
        core.startGroup('Analyzing ' + language);
        const queries = config.queries[language] || [];
        if (queries.length === 0) {
            throw new Error('Unable to analyse ' + language + ' as no queries were selected for this language');
        }
        try {
            const databasePath = util.getCodeQLDatabasePath(config.tempDir, language);
            // Pass the queries to codeql using a file instead of using the command
            // line to avoid command line length restrictions, particularly on windows.
            const querySuite = databasePath + '-queries.qls';
            const querySuiteContents = queries.map(q => '- query: ' + q).join('\n');
            fs.writeFileSync(querySuite, querySuiteContents);
            core.debug('Query suite file for ' + language + '...\n' + querySuiteContents);
            const sarifFile = path.join(sarifFolder, language + '.sarif');
            await codeql.databaseAnalyze(databasePath, sarifFile, querySuite);
            core.debug('SARIF results for database ' + language + ' created at "' + sarifFile + '"');
            core.endGroup();
        }
        catch (e) {
            // For now the fields about query performance are not populated
            return {
                analyze_failure_language: language,
            };
        }
    }
    return {};
}
async function run() {
    const startedAt = new Date();
    let queriesStats = undefined;
    let uploadStats = undefined;
    try {
        util.prepareLocalRunEnvironment();
        if (!await util.sendStatusReport(await util.createStatusReportBase('finish', 'starting', startedAt), true)) {
            return;
        }
        const config = await configUtils.getConfig(util.getRequiredEnvParam('RUNNER_TEMP'));
        core.exportVariable(sharedEnv.ODASA_TRACER_CONFIGURATION, '');
        delete process.env[sharedEnv.ODASA_TRACER_CONFIGURATION];
        const sarifFolder = core.getInput('output');
        fs.mkdirSync(sarifFolder, { recursive: true });
        core.info('Finalizing database creation');
        await finalizeDatabaseCreation(config);
        core.info('Analyzing database');
        queriesStats = await runQueries(sarifFolder, config);
        if ('true' === core.getInput('upload')) {
            uploadStats = await upload_lib.upload(sarifFolder, repository_1.parseRepositoryNwo(util.getRequiredEnvParam('GITHUB_REPOSITORY')), await util.getCommitOid(), util.getRef(), await util.getAnalysisKey(), util.getRequiredEnvParam('GITHUB_WORKFLOW'), util.getWorkflowRunID(), core.getInput('checkout_path'), core.getInput('matrix'), core.getInput('token'), util.getRequiredEnvParam('GITHUB_API_URL'), 'actions', logging_1.getActionsLogger());
        }
    }
    catch (error) {
        core.setFailed(error.message);
        console.log(error);
        await sendStatusReport(startedAt, queriesStats, uploadStats, error);
        return;
    }
    await sendStatusReport(startedAt, queriesStats, uploadStats);
}
run().catch(e => {
    core.setFailed("analyze action failed: " + e);
    console.log(e);
});
//# sourceMappingURL=analyze-action.js.map