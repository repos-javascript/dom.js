
"use strict";

importScripts('../dom.js');

var currentDoc = null;

var addEventListener = function(type, cb, bubble) {
	document.addEventListener(type, cb, bubble);
};

var window = {
	navigator: {
		userAgent: 'servo 0.1 webworker'
	},
	document: document,
	setTimeout: function() {
		//Function.apply(setTimeout, window, arguments)
	},
	clearTimeout: clearTimeout,
	setInterval: setInterval,
	clearInterval: clearInterval
}

var jQuery;
var $;

function print() {
	var out = '';
	for (var i = 0; i < arguments.length; i++) {
		out += arguments[i] + ' ';
	}
	postMessage(out);
}

var console = {log: print}

var parser_num = 1;
var parsing = {}

onerror = function(err) {
//	var stack = new Error().stack;
//	postMessage("ERROR " + err);// + " " + stack);
	return false;
}

onmessage = function(message) {
	try {
		var data = message.data;
		var reply = {}
		var parser = null;

		if (data.url) {
			parser = document.implementation.mozHTMLParser(data.url);
			var doc = parser.document();
			Object.defineProperty(this, "document", { value: doc});
			importScripts('jquery.js', 'qunit.js');
			jQuery = window.jQuery;
			$ = jQuery;

			doc.implementation.mozSetOutputMutationHandler(
				doc, function(msg) { postMessage(msg) }
			);
			parsing[parser_num] = parser;
			reply.parser = parser_num;
			parser_num++;
		} else {
			parser = parsing[data.parser];
			reply.parser = data.parser;
		}
		if (data.chunk) {
			currentDoc = parsing[reply.parser].document();
			parser.parse(data.chunk, data.finished);
			currentDoc = null;
		}
		if (data.finished) {
			reply.finished = true;
			currentDoc = parsing[reply.parser].document();
//			postMessage("DOC " + this.toString() + ' ' + (this.document === currentDoc));
			//document.documentElement = document.adoptNode(currentDoc.documentElement);
			parsing[reply.parser] = undefined;
			postMessage("Document loaded.");
			var event = document.createEvent('event');
			event.initEvent('load', false, true);
			document.dispatchEvent(event);
		}
		postMessage(reply);
	} catch (e) {
		postMessage("ERR " + e);
	}
}
