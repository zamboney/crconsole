var util = require("util"),
    url = require("url"),
    path = require("path"),
    repl = require("repl"),
    colors = require("colors"),
    chrome = require("chrome-remote-interface"),
    fs = require('fs'), 
    Log = require('log')
    log = new Log('info') ;

var cardinal = require('cardinal');
var resolveCardinalTheme = require('cardinal/settings').resolveTheme;
var app = require('express')();
var http = require('http').Server(app);
var io = require('socket.io')(http);

app.get('/', function(req, res){
  res.sendFile(__dirname + '/index.html');
});

io.on('connection', function(socket){
  console.log('a user connected');
});


http.listen(3000, function(){
  console.log('listening on *:3000');
});

const PROP_SHOW_COUNT = 5;

module.exports = ChromeREPL;

function ChromeREPL() {}

ChromeREPL.prototype = {

  start: function(options) {
    if (options.outputfile) {
      log = new Log('debug', fs.createWriteStream(options.outputfile  + '.log'));
    }
    this.connect(options, function(err, tab) {
      if (err) throw err;
      var self = this;

      console.log(tab.url.yellow)

      this.setTab(tab, function() {
        if (!self.repl) {
          self.repl = repl.start({
            prompt: self.getPrompt(),
            eval: self.eval.bind(self),
            input: process.stdin,
            output: process.stdout,
            writer: self.writer.bind(self)
          });
          if (!self.repl.setPrompt) { // assume node pre0.12 or io.js
            self.repl.setPrompt = function(p) {
              self.repl.prompt = p;
            };
          }
          self.defineCommands();
          self.replComplete  = self.repl.complete;
          self.repl.complete = self.complete.bind(self);
        } else {
          self.repl.displayPrompt();
        }
      });

    }.bind(this))
  },

  complete: function (line, callback) {
    var self = this;
    // TODO: .tab .switch .exit .help completions (but don't do local context completions)
    //this.replComplete.call(this.repl, line, function(err, cs) {
    //    return callback(null, cs);
    //  if (cs[0].length != 0) // we have repl command completions, don't need to avaluate in browser
    //     return callback(null, cs);
      self.chromeCompleter(line, callback);
    //});
  },

  injectedCompleterObj: function getCompletions(primitiveType) {
    var object;
    if (primitiveType==="string")
      object = new String("");
    else if(primitiveType==="number")
      object = new Number(0);
    else if(primitiveType==="boolean")
      object = new Boolean(false);
    else
      object=this;
    var resultSet={};
    for(var o=object;o;o=o.__proto__)
    {
      try {
        var names=Object.getOwnPropertyNames(o);
        for(var i=0;i<names.length;++i)
          resultSet[names[i]]=true;
      } catch(e) {}
    }
    return resultSet;
  },

  chromeCompleter: function (line, callback) {
    // TODO: object properties completions only atm
    // TODO: to add numbers, strings, etc use this evals:
    // evaluate( '(' + self.injectedCompleterObj.toString() + ')(\"string\");
    // evaluate( '(' + self.injectedCompleterObj.toString() + ')(\"number\");
    // evaluate( '(' + self.injectedCompleterObj.toString() + ')(\"boolean"\);

    var self = this;


    var completionsForObj = function(id, callback) {
      var params = {
        objectId: id,
        functionDeclaration: self.injectedCompleterObj.toString(),
        doNotPauseOnExceptionsAndMuteConsole: true,
        returnByValue: true,
        generatePreview:false
      };
      self.client.Runtime.callFunctionOn(params, function(err, res) {
         callback(err, res);
      });
    };
    var lastExpr = line.trim().split(/[ {}();\/\\]+/).slice(-1)[0];
    if (!lastExpr)
      return callback(null, [[], line]);
    // TODO obj['longproperyname completer in addition to obj.longproperyname
    var path = lastExpr.split('.');
    var expr, partial;
    if (path.length === 0) {
       expr = 'this';
       partial = '';
    } else if (path.length === 1) {
       expr = 'this';
       partial = path[0];
    } else {
       expr = path.slice(0, -1).join('.');
       partial = path[path.length -1];
    }
    var lineStart = line.slice(0, lastExpr.length - partial.length);

    // repl comands, not chrome completion
    var lineDot = line.split('.');
    if (lineDot.length > 1 && lineDot[0].trim() === '') {
      partial = lineDot[1];
      completions = Object.keys(self.repl.commands)
        .filter(function(c) { return c.indexOf('.' + partial) == 0 })
        .map(   function(c) { return lineDot[0] + c });
      return callback(null, [completions, line]);
    }

    var evalParams = {
       expression: expr,
       objectGroup: "completion",
       includeCommandLineAPI: true,
       doNotPauseOnExceptionsAndMuteConsole: true,
       contextId: self.runtimeContext.id,
       returnByValue:false,
       generatePreview:false
    }
    this.client.Runtime.evaluate(evalParams, function(err, res) {

      function done(params) {
        self.client.Runtime.releaseObjectGroup({"objectGroup":"completion"});
        callback(null, params);
      }
      if (res.wasThrown)
        return done(null, [[], line]);
      if (res.result.type === 'object') {
        completionsForObj(res.result.objectId, function(err, completions) {
           var allProps = Object.keys(completions.result.value);
           var completions = allProps
             .filter(function(c) { return c.indexOf(partial) == 0 })
             .map(   function(c) { return lineStart + c });
           done([completions, line]);
        });
      } else {
        // TODO get completions for String and Number
        done([[], line]);
      }
    });
  },

  connect: function(options, cb) {
    var self = this;
    self.options = options;
    var client = chrome.createClient();
    client.on("error", function(error) {
      console.log(error);
    });
    self.client = client;
    if (options.websocket) {
      return cb(null, {
        url: '',
        webSocketDebuggerUrl: options.websocket
      });
    } else {
      client.listTabs(options.host, options.port, function(err, tabs) {
        if(err) return cb(err);
        cb(null, tabs[0]);
      });
    }
  },

  writer: function(output) {
    if (!output)
      return ''

    function propertyValue(t, v) {
      if (t === 'string')
        return util.inspect(v, { colors: true });
      else if (t === 'number' || t === 'boolean')
        return v.toString().blue;
      else if (t === 'object' && v == 'null')
        return 'null'.blue;
      else if (t === 'undefined')
        return 'undefined'.gray;
      return t.grey;
    }
    function propertyPreview(p) {
      return p.name.magenta + ': ' + propertyValue(p.type, p.value);
    }
    function showPreview(obj) {
      if (!obj.preview) {
        return obj.className.yellow;
      }
      return obj.className.yellow + " { " +
         obj.preview.properties.map(propertyPreview).join(', ') +
      " }";
    }
    if (output.wasThrown) {
      return output.result.description.red;
    }
    if (output.result.type == 'function') {
      return '[Function]'.cyan;
    }
    if (output.result.type == 'undefined')
      return 'undefined'.gray;

    if (!output || output.result.type != "object") {
      // let inspect do its thing if it's a literal
      return util.inspect(output.result.value, { colors: true });
    }
    if (output.result.type === "object") {
      return showPreview(output.result);
    }
  },

  write: function(str, cb) {
    this.repl.outputStream.write(str, cb);
  },

  writeLn: function(str, cb) {
    this.repl.setPrompt('');
    this.repl.displayPrompt();
    this.repl.outputStream.write(str + '\n');
    this.repl.setPrompt(this.getPrompt());
    //this.repl.displayPrompt();
    if (cb) cb();
  },

  setTab: function(tab, cb) {
    this.tab = tab;
    var self = this;
    this.client.connectToWebSocket(tab.webSocketDebuggerUrl);
    this.client.removeAllListeners();
    this.client.on('connect', function() {
      cb();
      self._scripts = {};
      self.client.Runtime.disable();
      self.client.Runtime.enable();
      self.client.Runtime.executionContextCreated(function(ctxInfo) {
        self.runtimeContext = ctxInfo.context
      });
      self.client.Debugger.enable();
      self.client.Console.enable();
      self.client.send('DOM.enable');
      self.client.Debugger.scriptParsed(function(script) {
        self._scripts[script.scriptId] = script;
      })

      function handleMessage(message) {
        // TODO: handle objects. reuse eval's mirroring
        //console.log(JSON.stringify(message, null, 4));
        var stack = message.message.stackTrace;
        /* if (message.message.level !== 'log')
          return;
        var prefix = "> ".blue; */
        var messageLevel = message.message.level;
        var messageText = message.message.text;
        io.emit('log', messageText);
        if (messageLevel === 'info') {
          log.info(messageText);
          
          messageText = messageText.blue;
        } else if (messageLevel === 'warn') {
          log.warn(messageText);
          messageText = messageText.yellow;
        } else if (messageLevel === 'error') {
          log.error(messageText);
          messageText = messageText.red;
        }
        log.debug(messageText);

        //if (stack.length > 1 && stack[1].functionName == 'InjectedScript._evaluateOn')
        //  self.write('\n' + messageText + '\n');   // assume it's invoked from console - we don't need to scroll screen
        //else
        self.writeLn(messageText); // assume it's from user interaction - insert message above prompt
        self.repl.displayPrompt();
      }

      self.client.Console.messageAdded(function(message) {
        self.lastMessage = message;
        handleMessage(message);
      });

      // TODO: implement counter. Meanwhile, just repeat last message
      self.client.Console.messageRepeatCountUpdated(function() {
        handleMessage(self.lastMessage);
      });
      self.repl.setPrompt(self.getPrompt());

      // TODO: move to lib/dom.js
      self.client.on('DOM.inspectNodeRequested', function(node) {
        self.client.send('DOM.pushNodesByBackendIdsToFrontend', { backendNodeIds: [node.backendNodeId]}, function(err, nodes) {
          var nodeId = nodes.nodeIds[0];
          self.client.send('DOM.getOuterHTML', { nodeId: nodeId }, function(err, res) {
            // TODO: highlight html
            self.writeLn(res.outerHTML);
            self.client.send('DOM.setInspectMode', { mode: 'none' });
          });
        });
      });

      self.displayBacktrace = function() {
        var pad = function () {
          if (i > 99) return '';
          if (9 > 9) return ' ';
          return '   ';
        }

        var frames = "";
        var f;
        for (var i=0; i < self._breakFrames.length; ++i) {
          f = self._breakFrames[i]
          var s = self._scripts[f.location.scriptId];
          var loc = ':' + f.location.lineNumber + ':' + f.location.columnNumber;
          var title = s.url ? s.url : '<script ' + f.location.scriptId + '>';
          var cur = i == self._breakFrameId ? '>' : ' ';
          frames += cur + pad(i) + i + ' ' + title + loc + ' ' + f.this.className + '.' + f.functionName + '\n'
        }
        self.writeLn(frames);
      }

      self.displaySource = function() {
        var NUM_LINES = 5;
        function pad(maxLine, breakLine, num) {
          var spaces = '                       ';
          var w = String(maxLine).length;
          var n = String(num);
          n = spaces.slice(0, w - n.length) + n;
          if (num == breakLine) {
            n = '> ' + n + ' ';
          } else {
            n = '  ' + n + ' ';
          }
          return n;
        }

        var frame = self._breakFrames[self._breakFrameId];
        var lineNumber   = frame.location.lineNumber;
        var columnNumber = frame.location.columnNumber;
        self.client.Debugger.getScriptSource({ scriptId: frame.location.scriptId }, function(err, resp) {
          self.writeLn('break in ' + [lineNumber, columnNumber].join(':'))
          var startLine = lineNumber - NUM_LINES;
          var lastLine  = lineNumber + NUM_LINES;
          var out = [];
          var src = cardinal.highlight(resp.scriptSource, {
            theme: resolveCardinalTheme()
          }).split('\n');
          for (var i=startLine; i < lastLine; ++i) {
          var prefix = pad(lastLine, lineNumber, i);
          if (src[i])
            out.push(prefix + src[i]);
          }
          self.writeLn(out.join('\n'));
          // TODO mark current column with underline?
          //self.writeLn(src[lineNumber].underline);
          self.repl.setPrompt(frame.this.className + '.' + frame.functionName + '() > ');
          self.repl.displayPrompt();
        });
      }

      self.client.Debugger.paused(function(params) {
        self._breakFrameId = 0;
        self._breakFrames = params.callFrames;
        self.client.send('Page.setOverlayMessage', {message: 'paused in crconsole'});
        self.displaySource();
      });

      self.client.Debugger.resumed(function(params) {
        self.client.send('Page.setOverlayMessage', {});
        self.repl.setPrompt(self.getPrompt());
        self.repl.displayPrompt();
      });

      //self.client.CSS.enable();
      //self.client.CSS.getAllStyleSheets(function() {
      //  console.log('getAllStyleSheets');
      //  console.log(arguments);
      //});

      //self.client.CSS.styleSheetAdded(function() {
      //  console.log('css added');
      //  console.log(arguments);
      //});
      //self.client.CSS.styleSheetRemoved(function() {
      //  console.log('css removed');
      //  console.log(arguments);
      //});
      //self.client.CSS.styleSheetChanged(function() {
      //  console.log('css changed');
      //  console.log(arguments);
      //});

    });
  },

  getPrompt: function() {
    var parts = url.parse(this.tab.url);

    var name = parts.hostname;
    if (!name) {
      name = path.basename(parts.path);
    }
    return name + "> ";
  },

  // compliant with node REPL module eval function reqs
  eval: function(cmd, context, filename, cb) {
    this.evalInTab(cmd, cb);
  },

  evalInTab: function(input, cb) {
    var removeBrackets = function(input) {
      // node repl adds () to eval input while iojs not
      // try to detect here and remove
      if (input.slice(-2) === '\n)' && input.slice(0,1) == '(')
        return input.slice(1,-2);
      return input;
    };
    var self = this;
    if (!self._breakFrames) {
      this.client.Runtime.evaluate({expression: removeBrackets(input), generatePreview: true}, function(err, resp) {
        return cb(null, resp);
      });
    } else {
      var frame = self._breakFrames[self._breakFrameId];
      this.client.Debugger.evaluateOnCallFrame({
        callFrameId: frame.callFrameId,
        expression: removeBrackets(input)
      }, function(err, resp) {
        return cb(null, resp);
      });
    }
  },

  transformResult: function(result) {
    switch (result.type) {
      case "undefined":
        return undefined;
      case "null":
        return null;
    }
    return result;
  },

  defineCommands: function() {

    var self = this;

    this.repl.defineCommand('tabs', {
      help: 'list currently open tabs',
      action: this.listTabs.bind(this)
    });

    this.repl.defineCommand('quit', {
      help: 'quit crconsole',
      action: this.quit
    });

    this.repl.defineCommand('switch', {
      help: 'switch to evaluating in another tab by index',
      action: this.switchTab.bind(this)
    });

    this.repl.defineCommand('open', {
      help: 'open new tab',
      action: this.addTab.bind(this)
    });

    this.repl.defineCommand('s', {
      help: 'step into',
      action: function() {
        self.client.Debugger.stepInto();
      }
    });

    this.repl.defineCommand('bt', {
      help: 'back trace',
      action: function() {
        if (!self._breakFrames) {
          self.writeLn('Can\'t show backtrace: not stopped in debugger.');
        } else {
          self.displayBacktrace();
        }
      }
    });

    this.repl.defineCommand('up', {
      help: 'move up one or more frames',
      action: function(n) {
        if (n)
          n = parseInt(n);
        else
          n = 1;
        if (!self._breakFrames) {
          self.writeLn('Can\'t show backtrace: not stopped in debugger.');
        } else {
          self._breakFrameId += n
          if (self._breakFrameId >= self._breakFrames.length)
            self._breakFrameId = self._breakFrames.length - 1;
          self.displayBacktrace();
          self.displaySource()
        }
      }
    });

    this.repl.defineCommand('down', {
      help: 'move down one or more frames',
      action: function(n) {
        if (n)
          n = parseInt(n);
        else
          n = 1;
        if (!self._breakFrames) {
          self.writeLn('Can\'t show backtrace: not stopped in debugger.');
        } else {
          self._breakFrameId -= n
          if (self._breakFrameId < 0)
            self._breakFrameId = 0;
          self.displayBacktrace();
          self.displaySource()
        }
      }
    });

    this.repl.defineCommand('screen', {
      help: 'show screenshot',
      action: function(scaleStr) {
        var scale = parseFloat(scaleStr);
        if (!scale)
          scale = 0.5;
        var dimensions = "(function() { var body = document.body; var html = document.documentElement;"
        dimensions += "var width = Math.max( body.scrollWidth, body.offsetWidth,"
        dimensions += "html.clientWidth, html.scrollWidth, html.offsetWidth ); return width;})()";
        self.client.Runtime.evaluate({ expression: dimensions }, function(err, res) {
          var width = res.result.value * scale;
          self.client.Page.captureScreenshot(function(err, res) {
            var data = res.data;
            //var control = '\033]1337;File=;inline=1;width=' + width + 'px:' + data + '\07';
            var control = '\033]1337;File=test;inline=1:' + data + '\07';
            self.writeLn(control);
          });
        });
      }
    });

    this.repl.defineCommand('inspect', {
      help: 'set inspect mode',
      action: function(mode) {
        if (!mode) {
          //self.writeLn('need one of [searchForNode, searchForUAShadowDOM, showLayoutEditor, none] as argument');
          //return;
          mode = 'searchForNode';
        }
        // TODO: paddingColor, margin color etc
        // see https://chromedevtools.github.io/debugger-protocol-viewer/DOM/#type-HighlightConfig
        self.client.send('DOM.setInspectMode', {
          mode: mode,
          highlightConfig: {
            showInfo: true,
            showRulers: true,
            contentColor: {
              r: 100,
              g: 20,
              b: 20,
              a: 0.1
            }
          }
        });
      }
    });

    /*

    // WIP: allow to record to gif?
    // see https://github.com/sidorares/rfbrecord

    this.repl.defineCommand('record', {
      help: 'start screencast',
      action: function() {
        self.client.send('Page.startScreencast',
        //self.client.Page.startScreencast({
        {
          format: 'jpeg',
          quelity: 10
        })
        self.client.on('Page.screencastFrame', function(params) {
          var data = params.data;
          var width = params.metadata.deviceWidth / 4;
          var control = '\033]1337;File=;inline=1;width=' + width + 'px:' + data + '\07';
          self.writeLn(control);
          self.client.send('Page.screencastFrameAck', {
            sessionId: params.sessionId
          });
        });
      }
    });
    */

    this.repl.defineCommand('n', {
      help: 'step next',
      action: function() {
        self.client.Debugger.stepOver();
      }
    });

    this.repl.defineCommand('o', {
      help: 'step out',
      action: function() {
        self.client.Debugger.stepOut();
      }
    });

    this.repl.defineCommand('c', {
      help: 'continue',
      action: function() {
        self.client.Debugger.resume();
      }
    });

  },

  addTab: function(url) {
    var self = this;
    if ( (url.slice(0,7) != 'http://') && (url.slice(0,8) != 'https://') ) {
      url = 'http://' + url;
    }
    this.client.openTab(this.options.host, this.options.port, url, function(err, tab) {
      if (err) throw err;
      self.setTab(tab, function() {
        self.write((self.tab.url + "\n").yellow);
        self.repl.setPrompt(self.tab.url + '>');
        self.repl.displayPrompt();
      });
    });
  },

  switchTab: function(index) {
    this.client.close();
    var self = this;
    this.client.listTabs(this.options.host, this.options.port, function(err, tabs) {
      if (err) throw err;
      var tab = tabs[index];

      if (!tab) {
        this.write("no tab at index " + index + "\n");
      }
      else {
        self.setTab(tab, function() {
          self.write((self.tab.url + "\n").yellow);
          self.repl.displayPrompt();
        });
      }

    }.bind(this));
  },

  listTabs: function() {
    this.client.listTabs(this.host, this.options.port, function(err, tabs) {
      if (err) throw err;

      var strs = "";
      for (var i in tabs) {
        strs += "[" + i + "] " + tabs[i].url + "\n";
      }

      this.write(strs);
      this.repl.displayPrompt();
    }.bind(this));
  },

  quit: function() {
    process.exit(0);
  }
}
