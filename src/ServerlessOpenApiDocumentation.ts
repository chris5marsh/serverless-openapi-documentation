import * as c from 'chalk';
import * as fs from 'fs';
import * as YAML from 'js-yaml';
import { inspect } from 'util';
import { DefinitionGenerator } from './DefinitionGenerator';
import { IDefinitionType, ILog } from './types';
import { merge } from './utils';

export class ServerlessOpenApiDocumentation {
  public hooks;
  public commands;
  /** Serverless Instance */
  private serverless;
  /** CLI options */
  private options;
  /** Serverless Service Custom vars */
  private customVars;

  /**
   * Constructor
   * @param serverless
   * @param options
   */
  constructor (serverless, options) {
    // pull the serverless instance into our class vars
    this.serverless = serverless;
    // pull the CLI options into our class vars
    this.options = options;
    // Serverless service custom variables
    this.customVars = this.serverless.variables.service.custom;

    // Declare the commands this plugin exposes for the Serverless CLI
    this.commands = {
      openapi: {
        commands: {
          generate: {
            lifecycleEvents: [
              'serverless',
            ],
            usage: 'Generate OpenAPI v3 Documentation',
            options: {
              output: {
                usage: 'Output file location [default: openapi.yml|json]',
                shortcut: 'o',
              },
              format: {
                usage: 'OpenAPI file format (yml|json) [default: yml]',
                shortcut: 'f',
              },
              indent: {
                usage: 'File indentation in spaces [default: 2]',
                shortcut: 'i',
              },
            },
          },
        },
      },
    };

    // Declare the hooks our plugin is interested in
    this.hooks = {
      'openapi:generate:serverless': this.generate.bind(this),
    };
  }

  log: ILog = (...str: string[]) => {
    process.stdout.write(str.join(' '));
  }

  /**
   * Processes CLI input by reading the input from serverless
   * @returns config IConfigType
   */
  private processCliInput (): IDefinitionType {
    const config: IDefinitionType = {
      format: 'yaml',
      file: 'openapi.yml',
      indent: 2,
    };

    config.indent = this.serverless.processedInput.options.indent || 2;
    config.format = this.serverless.processedInput.options.format || 'yaml';

    if (['yaml', 'json'].indexOf(config.format.toLowerCase()) < 0) {
      throw new Error('Invalid Output Format Specified - must be one of "yaml" or "json"');
    }

    config.file = this.serverless.processedInput.options.output ||
      ((config.format === 'yaml') ? 'openapi.yml' : 'openapi.json');

    this.log(
      `${c.bold.green('[OPTIONS]')}`,
      `format: "${c.bold.red(config.format)}",`,
      `output file: "${c.bold.red(config.file)}",`,
      `indentation: "${c.bold.red(String(config.indent))}"\n\n`,
    );

    return config;
  }

  /**
   * Generates OpenAPI Documentation based on serverless configuration and functions
   */
  private generate () {
    this.log(c.bold.underline('OpenAPI v3 Documentation Generator\n\n'));
    // Instantiate DocumentGenerator
    const generator = new DefinitionGenerator(this.customVars.documentation);

    generator.parse();

    // Map function configurations
    const funcConfigs = this.serverless.service.getAllFunctions().map((functionName) => {
      const func = this.serverless.service.getFunction(functionName);
      return merge({ _functionName: functionName }, func);
    });

    // Add Paths to OpenAPI Output from Function Configuration
    generator.readFunctions(funcConfigs);

    // Process CLI Input options
    const config = this.processCliInput();

    this.log(`${ c.bold.yellow('[VALIDATION]') } Validating OpenAPI generated output\n`);

    const validation = generator.validate();

    if (validation.valid) {
      this.log(`${ c.bold.green('[VALIDATION]') } OpenAPI valid: ${c.bold.green('true')}\n\n`);
    } else {
      this.log(`${c.bold.red('[VALIDATION]')} Failed to validate OpenAPI document: \n\n`);
      this.log(`${c.bold.green('Context:')} ${JSON.stringify(validation.context, null, 2)}\n`);

      if (typeof validation.error === 'string') {
        this.log(`${validation.error}\n\n`);
      } else {
        for (const info of validation.error) {
          this.log(c.grey('\n\n--------\n\n'));
          this.log(' ', c.blue(info.dataPath), '\n');
          this.log(' ', info.schemaPath, c.bold.yellow(info.message));
          this.log(c.grey('\n\n--------\n\n'));
          this.log(`${inspect(info, { colors: true, depth: 2 })}\n\n`);
        }
      }
    }

    const { definition } = generator;

    // Output the OpenAPI document to the correct format

    let output;
    switch (config.format.toLowerCase()) {
    case 'json':
      output = JSON.stringify(definition, null, config.indent);
      break;
    case 'yaml':
    default:
      output = YAML.dump(definition, { indent: config.indent });
      break;
    }

    fs.writeFileSync(config.file, output);

    this.log(`${ c.bold.green('[OUTPUT]') } To "${c.bold.red(config.file)}"\n`);
  }
}
