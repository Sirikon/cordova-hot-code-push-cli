(function(){
  var path = require('path'),
      configFile = path.join(process.cwd(), 'cordova-hcp.json'),
      ignoreFile = path.join(process.cwd(), '.chcpignore'),
      envFile = path.join(process.cwd(), '.chcpenv'),
      // argv = require('optimist').argv,
      Q = require('q'),
      _ = require('lodash'),
      fs = require("fs"),
      sourceDirectory = path.join(process.cwd(), 'www'),
      buildDirectory = path.join(process.cwd(), '.chcpbuild'),
      watch = require('watch'),
      express = require('express'),
      app = express(),
      assetPort = process.env.PORT || 31284,
      compression = require('compression'),
      build = require('./build.js').execute,
      io,
      opts = {};

  module.exports = {
    execute: execute
  };


  function updateLocalEnv(localEnv) {
    localEnv.config_url = localEnv.content_url + '/chcp.json';

    var json = JSON.stringify(localEnv, null, 2);
    fs.writeFileSync(envFile, json);

    return localEnv;
  }

  function execute(argv) {
    var executeDfd = Q.defer();

    var funcs = [];

    funcs.push(function(){
      return publicTunnel(assetPort);
    });

    funcs.push(function(content_url) {
      var dfd = Q.defer();

      opts.content_url = content_url;
      opts.connect_url = content_url + '/connect';

      dfd.resolve();
      return dfd.promise;
    });

    funcs.push(function(debugOpts){
      if(debugOpts){
        opts.debug_url = debugOpts.debug_url;
        opts.console_url = debugOpts.console_url;
      }

      return assetServer(opts);
    });

    funcs.push(function(local_url){
      console.log('local_url', local_url);
      opts.local_url = local_url;
      opts.localdev = true;

      return build(opts);
    });

    funcs.push(function(){
      console.log('cordova-hcp local server available at: '+ opts.local_url);
      console.log('cordova-hcp public server available at: ' + opts.content_url);
    });

    return funcs.reduce(Q.when, Q('initial'));
  }

  function fileChangeFilter(file) {
    // Ignore changes in all files and folder containing .chcp
    // This excludes changes in build directory
    return !(
      file.indexOf('.chcp') !== -1 ||
      file.indexOf('chcp.json') !== -1 ||
      file.indexOf('chcp.manifest') !== -1
    );
  }

  function assetServer(opts) {
    var serverDfd = Q.defer(),
        localUrl = 'http://localhost:' + assetPort;

    // If a lot of files changes at the same time, we only want to trigger the change event once.
    handleFileChange = _.debounce(handleFileChange, 500);

    try {
      killCaches(app);
      serveStaticAssets(app, opts);
      serveSocketIO(app);
      watchForFileChange();
      serverDfd.resolve(localUrl);
    } catch(err) {
      console.error('assetServer error: ', err);
      serverDfd.reject(err);
    }

    return serverDfd.promise;
  }

  function watchForFileChange(){
    // Monitor for file changes
    console.log('Checking: ', sourceDirectory);
    watch.watchTree(sourceDirectory, {filter: fileChangeFilter}, function (f, curr, prev) {
      if (typeof f == "object" && prev === null && curr === null) {
        // Finished walking the tree
        // console.log('Finished');
      } else {
        handleFileChange(f);
      }
    });
  }

  function handleFileChange(file) {
    console.log('File changed: ', file);
    build(opts).then(function(config) {
      console.log('Should trigger reload for build: '+config.release);
      io.emit('release', { config: config });
    });
  }

  function serveSocketIO(app) {
    // Let's start the server
    io = require("socket.io")(app.listen(assetPort));

    // Open up socket for file change notifications
    //io.set('transports', ['polling']);
    io.on('connection', function(socket){
      console.log('a user connected');
      socket.on('disconnect', function(){
        console.log('user disconnected');
      });
    });
  }

  function serveStaticAssets(app, opts) {

    // Static assets
    app.use(compression());
    app.enable('view cache');
    app.use('/', express.static(sourceDirectory, { maxAge: 0 }));
  }

  function killCaches(ass) {
    // Disable caches
    app.disable('etag');
    app.use(function(req, res, next) {
      req.headers['if-none-match'] = 'no-match-for-this';
      next();
    });
  }

  function publicTunnel(port, options){
    var publicTunnelDfd = Q.defer(),
        ngrok = require('ngrok');

    // And make it accessible from the internet
    ngrok.connect(port, function (err, url) {
      if (err) {
        publicTunnelDfd.reject(err);
        return console.log('Could not create tunnel: ', err);
      }

      updateLocalEnv({content_url: url});

      publicTunnelDfd.resolve(url);
    });


    return publicTunnelDfd.promise;
  }
})();
