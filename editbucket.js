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
}

(function(){
	this.onAddToQueue = function(fun){
		this.addCb = fun;

		if(this.requestBus.length){
			this.sendItems();
		}
	};
	this.requestEdit = function(data){
		this.requestBus.push(data);

		if(!this.addCb) return;

		this.sendItems();
	};
	this.sendItems = function(){
		var currentItem;

		while(this.requestBus.length) {
			currentItem = this.requestBus.shift();

			this.addCb( currentItem );
		}
	};
	this.onReceiveEdit = function(fun){
		this.receiveCb = fun;
	};
	this.receiveEdit = function(editType, data, cb){
		if(!this.receiveCb) throw('no receiver installed for editbucket');
		this.receiveCb(editType, data, cb);
	};
	this.complete = function(err, data){
		this.completed = true;
		if(!this.completeCb) {
			this.completeErr = err;
			this.completeData = data;
			return;
		}
		this.completeCb(err, data);
		deleteBucket(this.key);
	};
	this.onComplete = function(fun){
		this.completeCb = fun;
		if(this.completed) {
			this.completeCb(this.completeErr, this.completeData);
			deleteBucket(this.key);
		}
	};
}).call(Bucket.prototype);

module.exports.getBucket = getBucket;
