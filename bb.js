#!/usr/bin/env node

var fs = require('fs'),
byline = require('byline'),
YAML = require('yamljs'),
csv = require('csv');

var argv = require('optimist')
.usage('Transform data according to a configuration and mapping file.\nUsage: $0')
.demand(['c','m','d'])
.alias('c', 'conf').alias('m', 'mapping').alias('d','data')
.argv;

var schema = YAML.load(argv.c);
var mapping = YAML.load(argv.m);
var entities = Object.keys(mapping);

var header = undefined;//the first line of data is expected to be a header 
//TODO: configure this in mapping file

var stream = byline(fs.createReadStream(argv.d, { encoding: 'utf8' }));

stream.on('data', function(line) {
	if(header == undefined)
	{
		header = line.split(',');
	}
	else
	{
		csv.parse(line,function(err, output){
			process(output[0]);
		});
	}
});

//process one line at a time
function process(data)
{
	var objects = entities.map(function(e){ return transformEntity(e,mapping[e],data)});

	//insert all found objects
	for(var key in objects)
	{
		console.log("CREATE: " + YAML.stringify(objects[key], 4));
	}
}

//transform the given entity and input values
//return one (or more) object that consists of key value pairs for each field
//or undefined if entity was not valid
function transformEntity(entity_name, entity, params)
{
	var fields = Object.keys(entity).map(function(f){
		var fqn = entity_name + "." + f;
		return transformField(fqn,entity[f],params)}
	);
	//TODO: If the entity file contains the same fieldname more than once,
	//in these cases fieldname ends with _0, _1 etc. I don't like it either.. to be fixed
	//anyway this method should return two objects then..
	
	var object = {};
	object["entity_name"] = entity_name;
	object["fields"] = fields;
	
	//TODO: validate each entity object, to see if the required fields are not undefined..

	return object;
}

//execute the given chain of transformers and input values
//return a key value pair: field_name -> transformed value
function transformField(field_name,field,params)
{
	//console.log("\nfield: " + field_name);

	var columns = field["input"];
	var data = undefined;

	if(columns != undefined)
	{
		//collect the input value
		data = columns.map(function(c){
			var index = header.indexOf(c);
			return params[index];
		});
	}
	
	//get the transformer chain
	var chain = field["transformer"];
	
	//execute the transformers chained together, input of the second is output of the first and so on.
	//console.log("IN: " + data);
	
	for(var key in chain)
	{
		try
		{
			var mod = "./transformers/" + chain[key] + ".js";
			data = require(mod).transform(field_name,data);
		}
		catch(e)
		{
			console.log(e); //transformer not found..
		}
	}

	//console.log("OUT: " + data);

	var pair = {};
	pair[field_name] = data;
	return pair;
} 
