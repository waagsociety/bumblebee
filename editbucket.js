var async = require('async'),
		_ = require('underscore');

var buckets = {};

function getBucket(key){
	var bucket = buckets[key];
	if(bucket) return bucket;
	bucket = buckets[key] = new Bucket(key);
	return bucket;
}

function deleteBucket(key){
	delete buckets[key];
}

function Bucket(key){
	this.key = key;
	this.requestBus = [];
	this.subscribers = [];
	this.loadScriptSubscribers = [];
	this.customSubscribers = [];
	this.statusSubscribers = [];
	this.completeCbs = [];
	this.outstandingRevisions = [];
	this.scriptsToLoad = [];
	this.customMessageInHandlers = {};
}

(function(){
	this.setTotalItems = function(amt){
		this.totalItems = amt;
	};
	this.addSubscriber = function(fun, socketId){
		this.subscribers.push({ send: fun, socketId: socketId });
		this.sendItems();
	};
	this.onAddToQueue = function(fun){
		this.addCb = fun;

		this.sendItems();
	};
	this.requestEdit = function(data){
		this.requestBus.push(data);

		this.sendItems();
	};
	this.sendItems = function(){
		var currentItem,
				subscriber;

		// resend oldest pending revision to other user. first user may have gone idle
		if(!this.requestBus.length && this.subscribers.length) {
			var i = 0;
			while(i < this.outstandingRevisions.length && this.subscribers.length){
				subscriber = this.subscribers.shift();
				subscriber.send( this.outstandingRevisions[i].item );
				i++;
			}
			return;
		}

		while( this.requestBus.length && this.subscribers.length ) {
			currentItem = this.requestBus.shift();
			subscriber = this.subscribers.shift();
			
			this.outstandingRevisions.push({
				socketId: subscriber.socketId,
				item: currentItem
			});

			subscriber.send( currentItem );
		}
	};
	this.onReceiveEdit = function(fun){
		this.receiveCb = fun;
	};
	this.receiveEdit = function(editType, data, cb){
		if(!this.receiveCb) throw('no receiver installed for editbucket');

		var outstandingRevisionIndex = -1;

		this.outstandingRevisions.forEach( function( revision, i ){
			if(revision.item.revisionId === data.revisionId){
				outstandingRevisionIndex = i;
			}
		});

		if(~outstandingRevisionIndex) this.outstandingRevisions.splice(outstandingRevisionIndex, 1);

		this.receiveCb(editType, data, cb);
	};
	this.onStatusUpdate = function( fun, socketId ){
		if( this.status ) fun( this.status );
		this.statusSubscribers.push( {
			send: fun,
			socketId: socketId
		} );
	};
	this.statusUpdate = function( status ){
		this.status = status.values;
		this.statusSubscribers.forEach( function( subscriber ){ subscriber.send( status.updated ); } );
	};
	this.complete = function(err, data){
		this.completed = true;
		if(!this.completeCbs.length) {
			this.completeErr = err ? err.message : undefined;
			this.completeData = data;
			return;
		}
		while(this.completeCbs.length) {
			this.completeCbs.shift().send(err ? err.message : undefined, data);
		}
		deleteBucket(this.key);
	};
	this.onComplete = function(fun, socketId){
		this.completeCbs.push( { send: fun, socketId: socketId } );
		if(this.completed) {
			while(this.completeCbs.length) {
				this.completeCbs.shift().send( this.completeErr, this.completeData );
			}
			//deleteBucket(this.key);
		}
	};
	this.loadScript = function( path ){
		this.scriptsToLoad.push( path );
		this.loadScriptSubscribers.forEach(function(subscriber){
			subscriber.send( path );
		});
	};
	this.onLoadScript = function( fun, socketId ){
		this.loadScriptSubscribers.push( { send: fun, socketId: socketId } );
		if(this.scriptsToLoad.length) this.scriptsToLoad.forEach( fun );
	};
	this.onCustomMessageOut = function( fun, socketId ){
		this.customSubscribers.push( { send: fun, socketId: socketId } );
	};
	this.customMessageOut = function( data ){
		this.customSubscribers.forEach(function(subscriber){
			subscriber.send( data );
		});
	};
	this.onForceComplete = function( fun ) {
		this.forceCompleteCb = fun;
	};
	this.forceComplete = function(){
		this.forceCompleteCb();
	};
	this.onCustomMessageIn = function( type, fun ){
		this.customMessageInHandlers[ type ] = fun;
	};
	this.customMessageIn = function( data, reply ){
		var handler = this.customMessageInHandlers[ data.type ];
		if( handler ) handler( data.data, reply );
		else console.log('no handler for ' + data.type + ' type of message, message:', data.data );
	};
	this.clearSubscriptions = function(socketId){
		['completeCbs', 'subscribers', 'statusSubscribers', 'loadScriptSubscribers', 'customSubscribers'].forEach(filterSubscribersList.bind(this));
		var outstandingRevisionIndex = -1,
				bucket = this;

		this.outstandingRevisions.forEach(resendRevisionIfSentToDisconnectedUser);

		this.outstandingRevisions.splice(outstandingRevisionIndex, 1);

		function filterSubscribersList(listName){
			this[listName] = this[listName].filter(subscriberMatchesSocketId);
		}

		function subscriberMatchesSocketId(subscriber){
			return subscriber.socketId !== socketId;
		}

		function resendRevisionIfSentToDisconnectedUser(revision, i){
			if(revision.socketId === socketId){
				outstandingRevisionIndex = i;
				bucket.requestEdit(revision.item);
			}
		}
	};
}).call(Bucket.prototype);

module.exports.getBucket = getBucket;
