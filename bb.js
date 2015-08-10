#!/usr/bin/env node

var fs = require('fs'),
byline = require('byline'),
YAML = require('js-yaml'),
validate = require('jsonschema').validate,
csv = require('csv');

var argv = require('optimist')
.usage('Transform data according to a configuration and mapping file.\nUsage: $0')
.demand(['c','m','d'])
.alias('c', 'conf').alias('m', 'mapping').alias('d','data')
.argv;

console.log('parsing schema');
var schema = YAML.safeLoad(fs.readFileSync(argv.c, 'utf8'));

var mapping = YAML.safeLoad(fs.readFileSync(argv.m, 'utf8'));
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
	var objects = mapping.map(function(e){ 
		var entity_name = Object.keys(e)[0];
		var entity = e[entity_name];
		return transformEntity(entity_name,entity,data)
	});

	//insert all found objects
	for(var key in objects)
	{
		var object = objects[key];
		if(object != undefined)
		{
			console.log("create: " + YAML.safeDump(object));
		}
	}
}

//transform the given entity and input values
//return one (or more) object that consists of key value pairs for each field
//or undefined if entity was not valid
function transformEntity(entity_name, entity, params)
{
	//map the fields to their transformed counterparts
	var fields = Object.keys(entity).map(function(f){
		return transformField(f,entity[f],params);
	});

	//reduce the set of fields to an object
	var object = fields.reduce(function(obj, k) {
		var key = Object.keys(k)[0]; //first property
		obj[key] = k[key];
		return obj;
	}, {});
	
	//validate the entity
	if(isValid(entity_name, object))
	{
		object["class"] = entity_name;
		return object;
	}
		
	return undefined;
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

	var pair = {};
	pair[field_name] = data;
	return pair;
} 

//validates according to json-schema
function isValid(entity_name, object)
{
	var def = schema[entity_name];
	var result = validate(object,def);
	if(result.valid == false)
	{
		console.log('x');
	}
	return result.valid;
}
