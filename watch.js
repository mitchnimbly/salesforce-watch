'use strict';

const exec = require('child_process').exec;
const Spinner = require('cli-spinner').Spinner;
const chalk = require('chalk');
const watchman = require('fb-watchman');
const client = new watchman.Client();

let subDir = 'src';

if (process.env.WATCH_DIR) {
  subDir = process.env.WATCH_DIR;
}

const dir_of_interest = `${process.cwd()}/${subDir}`;

client.capabilityCheck(
  { optional: [], required: ['relative_root'] },
  (error, resp) => {
    if (error) {
      console.log(error);
      client.end();
      return;
    }

    // Initiate the watch
    client.command(['watch-project', dir_of_interest], (error, resp) => {
      if (error) {
        console.error('Error initiating watch:', error);
        return;
      }

      if ('warning' in resp) {
        console.log('warning: ', resp.warning);
      }

      console.log(
        'watch established on ',
        resp.watch,
        ' relative_path',
        resp.relative_path
      );

      make_time_constrained_subscription(
        client,
        resp.watch,
        resp.relative_path
      );
    });
  }
);

function make_time_constrained_subscription(client, watch, relative_path) {
  client.command(['clock', watch], (error, resp) => {
    if (error) {
      console.error('Failed to query clock:', error);
      return;
    }

    const sub = {
      // Match any `.cls` file in the dir_of_interest
      expression: ['anyof', ['match', '*.cls'], ['match', '*.trigger']],
      // Which fields we're interested in
      fields: ['name', 'size', 'mtime_ms', 'exists', 'type'],
      // add our time constraint
      since: resp.clock,
    };

    if (relative_path) {
      sub.relative_root = relative_path;
    }

    client.command(
      ['subscribe', watch, 'mysubscription', sub],
      (error, resp) => {
        if (error) {
          // Probably an error in the subscription criteria
          console.error('failed to subscribe: ', error);
          return;
        }
        console.log(`subscription ${resp.subscribe} established`);
        console.log('');
      }
    );
    client.on('subscription', handleSubscription);
  });
}

const handleSubscription = resp => {
  if (resp.subscription !== 'mysubscription') return;

  const files = parseFiles(resp.files);

  if (files.classes.length > 0) {
    const spinner = getSpinner(files.classes);
    spinner.start();
    exec(
      `force push -t ApexClass -n ${files.classes.join(',')}`,
      handlePushResult(spinner)
    );
  }

  if (files.triggers.length > 0) {
    const spinner = getSpinner(files.triggers);
    spinner.start();
    exec(
      `force push -t ApexTrigger -n ${files.triggers.join(',')}`,
      handlePushResult(spinner)
    );
  }
};

const handlePushResult = spinner =>
  function handlePushResult(err, stdout, stderr) {
    spinner.stop(true);
    if (err) {
      console.error(`exec error: ${err}`);
      console.error(`stderr: ${JSON.stringify(stderr, false, 2)}`);
      return;
    }
    console.log(stdout);
  };

function parseFiles(files = []) {
  const result = {
    classes: [],
    triggers: [],
  };
  files.forEach(file => {
    const regex = /(classes|trigger)\/(.*)\.(cls|trigger)/gm;

    let match;

    while ((match = regex.exec(file.name)) !== null) {
      // This is necessary to avoid infinite loops with zero-width matches
      if (match.index === regex.lastIndex) {
        regex.lastIndex++;
      }

      const [, folder, filename] = match;

      if (folder === 'classes') {
        result.classes.push(filename);
      }
      if (folder === 'triggers') {
        result.triggers.push(filename);
      }
    }
  });
  return result;
}

function getSpinner(files = []) {
  // Go Nimbly green spinner

  const spinner = new Spinner(
    // Ideally should indicate which login is active
    `${chalk.rgb(119, 181, 31)('%s')} Deploying ${files.join(', ')}`
  );
  spinner.setSpinnerString(18);
  return spinner;
}
