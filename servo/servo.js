var worker = new Worker('servo-worker.js');
var renderer;

worker.addEventListener("message", function(event) {
    var cmd = event.data[0];
    var data = event.data[1];

    switch(cmd) {
    case "log":
        console.log("WORKER", data);
        break;
    case "warn":
        console.warn("WORKER", data);
        break;
    case "error":
        console.error("WORKER", data);
        break;
    }
});

window.onload = function() {
    new TreeRenderer(worker, document.getElementById("n1"));
    renderer = new IFrameRenderer(worker, document.getElementById("renderframe"));

    var form = document.getElementById("url");
    form.url.value = window.location.href.split('/').slice(0, -1).join('/') + '/foo.html';
    form.onsubmit = function(e) {
        document.getElementById('n1').innerHTML = '';
        var url = form.url.value;
        renderer.setBaseHref(url);
        worker.postMessage(["load", url]);

        e.preventDefault();
    }

    var create = document.getElementById('new-element');
    create.onsubmit = function(ev) {
        worker.postMessage(["create", create.name.value]);
        ev.preventDefault();
    }
};

