"use strict";


var socket=null;
var serverInfo;
var reconnectTimeout=null;
var queue=[];

self.onmessage=function(event){
var _event$data=event.data,type=_event$data.type,server=_event$data.server,data=_event$data.data;
if(type==='connect'){
serverInfo=server;
connectToServer();
}else if(type==='send'){
if(socket&&socket.readyState===WebSocket.OPEN){
socket.send(data);
}else{
queue.push(data);
}
}else if(type==='disconnect'){
if(socket)socket.close();
if(reconnectTimeout)clearTimeout(reconnectTimeout);
socket=null;
}
};

function connectToServer(){

var protocol=serverInfo.protocol||'https';
var host=serverInfo.host||self.location.hostname;
var prefix=serverInfo.prefix||'/showdown';
var baseURL=protocol+"://"+host+prefix;
postMessage({type:'debug',data:'[worker] baseURL '+baseURL+' t='+Date.now()});

try{
var start=Date.now();

socket=new SockJS(baseURL,[],{timeout:5*60*1000});
postMessage({type:'debug',data:'[worker] SockJS created in '+(Date.now()-start)+'ms'});
}catch(err){
postMessage({type:'debug',data:'[worker] SockJS failed '+err.message});
try{
var wsURL=baseURL.replace('http','ws')+'/websocket';
postMessage({type:'debug',data:'[worker] attempting WS fallback '+wsURL});
socket=new WebSocket(wsURL);
}catch(err2){
postMessage({type:'error',data:'Failed to create socket: '+err2.message});
return;
}
}

if(!socket){
postMessage({type:'error',data:'No socket created'});
return;
}

socket.onopen=function(){
postMessage({type:'debug',data:'[worker] onopen t='+Date.now()});
postMessage({type:'connected'});for(var _i2=0,_queue2=
queue;_i2<_queue2.length;_i2++){var _socket;var msg=_queue2[_i2];(_socket=socket)==null||_socket.send(msg);}
queue=[];
};

socket.onmessage=function(e){
var raw=''+e.data;

if(typeof raw==='string'&&raw.length<200){
postMessage({type:'debug',data:'[worker] frame sample '+raw.slice(0,80)});
}
if(typeof raw==='string'&&raw.startsWith('a[')){
try{
var arr=JSON.parse(raw.slice(1));for(var _i4=0;_i4<
arr.length;_i4++){var msg=arr[_i4];postMessage({type:'message',data:msg});}
return;
}catch(e){
postMessage({type:'debug',data:'[worker] failed to parse SockJS frame'});
}
}
postMessage({type:'message',data:raw});
};

socket.onclose=function(){
postMessage({type:'debug',data:'[worker] onclose t='+Date.now()});
postMessage({type:'disconnected'});
};

socket.onerror=function(err){var _socket2;
postMessage({type:'error',data:err.message||''});
postMessage({type:'debug',data:'[worker] onerror t='+Date.now()});
(_socket2=socket)==null||_socket2.close();
};
}
//# sourceMappingURL=client-connection-worker.js.map