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
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const core = __importStar(require("@actions/core"));
const safe_which_1 = require("@chrisgavin/safe-which");
const uuid_1 = require("uuid");
const actions_util_1 = require("./actions-util");
const api_client_1 = require("./api-client");
const config_utils_1 = require("./config-utils");
const environment_1 = require("./environment");
const feature_flags_1 = require("./feature-flags");
const init_1 = require("./init");
const languages_1 = require("./languages");
const logging_1 = require("./logging");
const repository_1 = require("./repository");
const setup_codeql_1 = require("./setup-codeql");
const status_report_1 = require("./status-report");
const trap_caching_1 = require("./trap-caching");
const util_1 = require("./util");
const workflow_1 = require("./workflow");
async function sendCompletedStatusReport(startedAt, config, toolsDownloadDurationMs, toolsFeatureFlagsValid, toolsSource, toolsVersion, logger, error) {
    const statusReportBase = await (0, status_report_1.createStatusReportBase)("init", (0, status_report_1.getActionsStatus)(error), startedAt, await (0, util_1.checkDiskUsage)(logger), error?.message, error?.stack);
    const workflowLanguages = (0, actions_util_1.getOptionalInput)("languages");
    const initStatusReport = {
        ...statusReportBase,
        tools_input: (0, actions_util_1.getOptionalInput)("tools") || "",
        tools_resolved_version: toolsVersion,
        tools_source: toolsSource || setup_codeql_1.ToolsSource.Unknown,
        workflow_languages: workflowLanguages || "",
    };
    const initToolsDownloadFields = {};
    if (toolsDownloadDurationMs !== undefined) {
        initToolsDownloadFields.tools_download_duration_ms =
            toolsDownloadDurationMs;
    }
    if (toolsFeatureFlagsValid !== undefined) {
        initToolsDownloadFields.tools_feature_flags_valid = toolsFeatureFlagsValid;
    }
    if (config !== undefined) {
        const languages = config.languages.join(",");
        const paths = (config.originalUserInput.paths || []).join(",");
        const pathsIgnore = (config.originalUserInput["paths-ignore"] || []).join(",");
        const disableDefaultQueries = config.originalUserInput["disable-default-queries"]
            ? languages
            : "";
        const queries = [];
        let queriesInput = (0, actions_util_1.getOptionalInput)("queries")?.trim();
        if (queriesInput === undefined || queriesInput.startsWith("+")) {
            queries.push(...(config.originalUserInput.queries || []).map((q) => q.uses));
        }
        if (queriesInput !== undefined) {
            queriesInput = queriesInput.startsWith("+")
                ? queriesInput.slice(1)
                : queriesInput;
            queries.push(...queriesInput.split(","));
        }
        // Append fields that are dependent on `config`
        const initWithConfigStatusReport = {
            ...initStatusReport,
            disable_default_queries: disableDefaultQueries,
            languages,
            ml_powered_javascript_queries: (0, config_utils_1.getMlPoweredJsQueriesStatus)(config),
            paths,
            paths_ignore: pathsIgnore,
            queries: queries.join(","),
            trap_cache_languages: Object.keys(config.trapCaches).join(","),
            trap_cache_download_size_bytes: Math.round(await (0, trap_caching_1.getTotalCacheSize)(config.trapCaches, logger)),
            trap_cache_download_duration_ms: Math.round(config.trapCacheDownloadTime),
        };
        await (0, status_report_1.sendStatusReport)({
            ...initWithConfigStatusReport,
            ...initToolsDownloadFields,
        });
    }
    else {
        await (0, status_report_1.sendStatusReport)({ ...initStatusReport, ...initToolsDownloadFields });
    }
}
async function run() {
    const startedAt = new Date();
    const logger = (0, logging_1.getActionsLogger)();
    (0, util_1.initializeEnvironment)((0, actions_util_1.getActionVersion)());
    let config;
    let codeql;
    let toolsDownloadDurationMs;
    let toolsFeatureFlagsValid;
    let toolsSource;
    let toolsVersion;
    const apiDetails = {
        auth: (0, actions_util_1.getRequiredInput)("token"),
        externalRepoAuth: (0, actions_util_1.getOptionalInput)("external-repository-token"),
        url: (0, util_1.getRequiredEnvParam)("GITHUB_SERVER_URL"),
        apiURL: (0, util_1.getRequiredEnvParam)("GITHUB_API_URL"),
    };
    const gitHubVersion = await (0, api_client_1.getGitHubVersion)();
    (0, util_1.checkGitHubVersionInRange)(gitHubVersion, logger);
    const repositoryNwo = (0, repository_1.parseRepositoryNwo)((0, util_1.getRequiredEnvParam)("GITHUB_REPOSITORY"));
    const registriesInput = (0, actions_util_1.getOptionalInput)("registries");
    const features = new feature_flags_1.Features(gitHubVersion, repositoryNwo, (0, actions_util_1.getTemporaryDirectory)(), logger);
    core.exportVariable(environment_1.EnvVar.JOB_RUN_UUID, (0, uuid_1.v4)());
    try {
        if (!(await (0, status_report_1.sendStatusReport)(await (0, status_report_1.createStatusReportBase)("init", "starting", startedAt, await (0, util_1.checkDiskUsage)(logger))))) {
            return;
        }
        const codeQLDefaultVersionInfo = await features.getDefaultCliVersion(gitHubVersion.type);
        toolsFeatureFlagsValid = codeQLDefaultVersionInfo.toolsFeatureFlagsValid;
        const initCodeQLResult = await (0, init_1.initCodeQL)((0, actions_util_1.getOptionalInput)("tools"), apiDetails, (0, actions_util_1.getTemporaryDirectory)(), gitHubVersion.type, codeQLDefaultVersionInfo, logger);
        codeql = initCodeQLResult.codeql;
        toolsDownloadDurationMs = initCodeQLResult.toolsDownloadDurationMs;
        toolsVersion = initCodeQLResult.toolsVersion;
        toolsSource = initCodeQLResult.toolsSource;
        await (0, workflow_1.validateWorkflow)(codeql, logger);
        config = await (0, init_1.initConfig)((0, actions_util_1.getOptionalInput)("languages"), (0, actions_util_1.getOptionalInput)("queries"), (0, actions_util_1.getOptionalInput)("packs"), registriesInput, (0, actions_util_1.getOptionalInput)("config-file"), (0, actions_util_1.getOptionalInput)("db-location"), (0, actions_util_1.getOptionalInput)("config"), getTrapCachingEnabled(), 
        // Debug mode is enabled if:
        // - The `init` Action is passed `debug: true`.
        // - Actions step debugging is enabled (e.g. by [enabling debug logging for a rerun](https://docs.github.com/en/actions/managing-workflow-runs/re-running-workflows-and-jobs#re-running-all-the-jobs-in-a-workflow),
        //   or by setting the `ACTIONS_STEP_DEBUG` secret to `true`).
        (0, actions_util_1.getOptionalInput)("debug") === "true" || core.isDebug(), (0, actions_util_1.getOptionalInput)("debug-artifact-name") || util_1.DEFAULT_DEBUG_ARTIFACT_NAME, (0, actions_util_1.getOptionalInput)("debug-database-name") || util_1.DEFAULT_DEBUG_DATABASE_NAME, repositoryNwo, (0, actions_util_1.getTemporaryDirectory)(), codeql, (0, util_1.getRequiredEnvParam)("GITHUB_WORKSPACE"), gitHubVersion, apiDetails, features, logger);
        if (config.languages.includes(languages_1.Language.python) &&
            (0, actions_util_1.getRequiredInput)("setup-python-dependencies") === "true") {
            if (await features.getValue(feature_flags_1.Feature.DisablePythonDependencyInstallationEnabled, codeql)) {
                logger.info("Skipping python dependency installation");
            }
            else {
                try {
                    await (0, init_1.installPythonDeps)(codeql, logger);
                }
                catch (unwrappedError) {
                    const error = (0, util_1.wrapError)(unwrappedError);
                    logger.warning(`${error.message} You can call this action with 'setup-python-dependencies: false' to disable this process`);
                }
            }
        }
    }
    catch (unwrappedError) {
        const error = (0, util_1.wrapError)(unwrappedError);
        core.setFailed(error.message);
        await (0, status_report_1.sendStatusReport)(await (0, status_report_1.createStatusReportBase)("init", error instanceof util_1.UserError ? "user-error" : "aborted", startedAt, await (0, util_1.checkDiskUsage)(), error.message, error.stack));
        return;
    }
    try {
        // Forward Go flags
        const goFlags = process.env["GOFLAGS"];
        if (goFlags) {
            core.exportVariable("GOFLAGS", goFlags);
            core.warning("Passing the GOFLAGS env parameter to the init action is deprecated. Please move this to the analyze action.");
        }
        // https://github.com/github/codeql-team/issues/2411
        if (config.languages.includes(languages_1.Language.go) &&
            process.platform === "linux") {
            try {
                const goBinaryPath = await (0, safe_which_1.safeWhich)("go");
                const fileOutput = await (0, actions_util_1.getFileType)(goBinaryPath);
                if (fileOutput.includes("statically linked")) {
                    // Create a directory that we can add to the system PATH.
                    const tempBinPath = path.resolve((0, actions_util_1.getTemporaryDirectory)(), "bin");
                    fs.mkdirSync(tempBinPath, { recursive: true });
                    core.addPath(tempBinPath);
                    // Write the wrapper script to the directory we just added to the PATH.
                    const goWrapperPath = path.resolve(tempBinPath, "go");
                    fs.writeFileSync(goWrapperPath, `#!/bin/bash\n\nexec ${goBinaryPath} "$@"`);
                    fs.chmodSync(goWrapperPath, "755");
                    // Store the original location of our wrapper script somewhere where we can
                    // later retrieve it from and cross-check that it hasn't been changed.
                    core.exportVariable(environment_1.EnvVar.GO_BINARY_LOCATION, goWrapperPath);
                }
            }
            catch (e) {
                core.warning(`Analyzing Go on Linux, but failed to install wrapper script: ${e}`);
            }
        }
        // Limit RAM and threads for extractors. When running extractors, the CodeQL CLI obeys the
        // CODEQL_RAM and CODEQL_THREADS environment variables to decide how much RAM and how many
        // threads it would ask extractors to use. See help text for the "--ram" and "--threads"
        // options at https://codeql.github.com/docs/codeql-cli/manual/database-trace-command/
        // for details.
        core.exportVariable("CODEQL_RAM", process.env["CODEQL_RAM"] ||
            (0, util_1.getMemoryFlagValue)((0, actions_util_1.getOptionalInput)("ram"), logger).toString());
        core.exportVariable("CODEQL_THREADS", (0, util_1.getThreadsFlagValue)((0, actions_util_1.getOptionalInput)("threads"), logger).toString());
        // Disable Kotlin extractor if feature flag set
        if (await features.getValue(feature_flags_1.Feature.DisableKotlinAnalysisEnabled)) {
            core.exportVariable("CODEQL_EXTRACTOR_JAVA_AGENT_DISABLE_KOTLIN", "true");
        }
        const kotlinLimitVar = "CODEQL_EXTRACTOR_KOTLIN_OVERRIDE_MAXIMUM_VERSION_LIMIT";
        if ((await (0, util_1.codeQlVersionAbove)(codeql, "2.13.4")) &&
            !(await (0, util_1.codeQlVersionAbove)(codeql, "2.14.4"))) {
            core.exportVariable(kotlinLimitVar, "1.9.20");
        }
        if (config.languages.includes(languages_1.Language.java)) {
            const envVar = "CODEQL_EXTRACTOR_JAVA_RUN_ANNOTATION_PROCESSORS";
            if (process.env[envVar]) {
                logger.info(`Environment variable ${envVar} already set. Not en/disabling CodeQL Java Lombok support`);
            }
            else if (await features.getValue(feature_flags_1.Feature.CodeqlJavaLombokEnabled, codeql)) {
                logger.info("Enabling CodeQL Java Lombok support");
                core.exportVariable(envVar, "true");
            }
            else {
                logger.info("Disabling CodeQL Java Lombok support");
                core.exportVariable(envVar, "false");
            }
        }
        // Disable Python dependency extraction if feature flag set
        if (await features.getValue(feature_flags_1.Feature.DisablePythonDependencyInstallationEnabled, codeql)) {
            core.exportVariable("CODEQL_EXTRACTOR_PYTHON_DISABLE_LIBRARY_EXTRACTION", "true");
        }
        const sourceRoot = path.resolve((0, util_1.getRequiredEnvParam)("GITHUB_WORKSPACE"), (0, actions_util_1.getOptionalInput)("source-root") || "");
        const tracerConfig = await (0, init_1.runInit)(codeql, config, sourceRoot, "Runner.Worker.exe", registriesInput, features, apiDetails, logger);
        if (tracerConfig !== undefined) {
            for (const [key, value] of Object.entries(tracerConfig.env)) {
                core.exportVariable(key, value);
            }
        }
        core.setOutput("codeql-path", config.codeQLCmd);
    }
    catch (unwrappedError) {
        const error = (0, util_1.wrapError)(unwrappedError);
        core.setFailed(error.message);
        await sendCompletedStatusReport(startedAt, config, toolsDownloadDurationMs, toolsFeatureFlagsValid, toolsSource, toolsVersion, logger, error);
        return;
    }
    await sendCompletedStatusReport(startedAt, config, toolsDownloadDurationMs, toolsFeatureFlagsValid, toolsSource, toolsVersion, logger);
}
function getTrapCachingEnabled() {
    // If the workflow specified something always respect that
    const trapCaching = (0, actions_util_1.getOptionalInput)("trap-caching");
    if (trapCaching !== undefined)
        return trapCaching === "true";
    // On self-hosted runners which may have slow network access, disable TRAP caching by default
    if (!(0, util_1.isHostedRunner)())
        return false;
    // On hosted runners, enable TRAP caching by default
    return true;
}
async function runWrapper() {
    try {
        await run();
    }
    catch (error) {
        core.setFailed(`init action failed: ${(0, util_1.wrapError)(error).message}`);
    }
    await (0, util_1.checkForTimeout)();
}
void runWrapper();
//# sourceMappingURL=init-action.js.map