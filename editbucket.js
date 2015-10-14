var async = require('async'),
		_ = require('underscore');

var buckets = {};

function getBucket(key){
	var bucket = buckets[key];
	if(bucket) return bucket;
	bucket = buckets[key] = new Bucket();
	return bucket;
}

function deleteBucket(key){
	delete buckets[key];
}

function Bucket(){
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
		console.log('requestEdit', data);
		var currentItem;
		//process.exit();
		this.requestBus.push(data);

		if(!this.addCb) return;

		this.sendItems();
	};
	this.sendItems = function(){
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
}).call(Bucket.prototype);

module.exports.getBucket = getBucket;
