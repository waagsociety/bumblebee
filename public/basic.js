var socket,
		socketKey,
		validator;

document.addEventListener( 'DOMContentLoaded', documentReady );

function documentReady(){
	initEventHandlers();
	initConnection();

	if( window.ZSchema ) validator = new ZSchema();
}

var boundDelegates = {},
		eventHandlers = {
			'#mapping': { change: setConvertLink },
			'#pending-revisions': { DOMNodeInserted: requestAdded },
			'input.modify': { keyup: handleModifyKeyUp },
			'.resultItem.valid, .resultItem.approved': { click: toggleResultStatus },
			'.reject-all': { click: rejectAll },
			'.approve-all': { click: approveAll }
		};
function initEventHandlers(){
	Object.keys(eventHandlers).forEach(bindHandlersForElement);

	function bindHandlersForElement( selector ){
		var handlers = eventHandlers[selector],
				element = document.querySelector( selector );
		if( element ) Object.keys( handlers ).forEach( bindEvent );
		else Object.keys( handlers ).forEach( bindDelegate );

		function bindEvent( eventName ){
			element.addEventListener( eventName, handlers[eventName] );
		}

		function bindDelegate( eventName ){
			if( !boundDelegates[eventName] ) {
				boundDelegates[eventName] = {};
				document.addEventListener( eventName, createDelegateHandler( eventName ) );
			}
			boundDelegates[ eventName ][ selector] = handlers[eventName];
		}
	}

	function createDelegateHandler( eventName ) {
		return function delegateEvent(e){
			var delegates = boundDelegates[eventName],
					target = e.target,
					result = true, didAnyCancel;

			while( target && result ){
				didAnyCancel = Object.keys( delegates ).map( evaluateHandler );
				result = !~didAnyCancel.indexOf(false);

				target = target.parentNode;
			}

			function evaluateHandler( selector ){
				if( target.matches && target.matches( selector ) ) return delegates[selector].call( target, e );
			}
		}
	}
}

function toggleResultStatus(e){
	this.classList.toggle('valid');
	this.classList.toggle('approved');

	var invalidItems = document.querySelectorAll( '.resultItem.invalid' ),
			validItems = document.querySelectorAll( '.resultItem.valid' );

	if( !invalidItems.length && !validItems.length ){
		sendRevisions( this.bbQuerySelectorParent('tr[data-revision-id]') );
	}
}

function rejectAll(e){
	sendRevisions( e.target.bbQuerySelectorParent('[data-revision-id]'), 'dismiss' );
}

function approveAll(e){
	var invalidItems = document.querySelectorAll( '.resultItem.invalid' );

	if( !invalidItems.length ){
		sendRevisions( e.target.bbQuerySelectorParent('[data-revision-id]') );
	}
}

function handleModifyKeyUp(e){
	if( e.keyCode === 13 ) { //enter
		return approveAll();
	}

	if(e.keyCode === 27 ) { //escape
		return rejectAll();
	}

	var modifyItem = this.bbQuerySelectorParent( '.modifiableItem' ),
			entity = revisingEntities[modifyItem.dataset.key],
			resultItem = modifyItem && document.querySelector( '.resultItem[data-key=' + modifyItem.dataset.key + ']' ),
			resultValueElement = resultItem.querySelector('td[data-key=' + this.dataset.key + ']' );

	resultValueElement.innerHTML = this.value;

	entity.currentValues[this.dataset.key] = this.value;

	if( validator.validate( entity.currentValues, entity.schema ) ) {
		resultItem.classList.add('valid');
		resultItem.classList.remove('invalid');
	} else {
		resultItem.classList.add('invalid');
		resultItem.classList.remove('valid');
		resultItem.classList.remove('approved');
	}
}

function requestAdded(e){
	var firstEmptyElement;
	e.target.querySelectorAll && Array.prototype.forEach.call(e.target.querySelectorAll('input'), checkIfIsFirstEmptyInput);

	function checkIfIsFirstEmptyInput(element){
		if( !firstEmptyElement && !element.value ) firstEmptyElement = element;
	}

	if(firstEmptyElement) firstEmptyElement.focus();
}

function setConvertLink(){
	var url = location.href + '/transform/' + document.getElementById( 'mapping' ).value;
	document.getElementById('transform').removeAttribute("disabled");
	document.getElementById('transform').href = url;
}

function initConnection(){
	if( !window.io ) return;

	socket = io();

	var keyContainer = document.getElementById('socketkey');
	
	socketKey = keyContainer && keyContainer.dataset.socketkey;
	
	socket.emit('socketkey', socketKey);

	socket.on('requestedit', createRevisionJob);

	socket.on('remove', removeRevision);

	socket.on('complete', handleComplete);
}

var maxRevisionsToShow = 1,
		revisionsBuffer = [],
		revisionItems = {};

function createRevisionJob(data){
	var tbody = document.querySelector('#pending-revisions tbody');

	if(tbody.children.length < maxRevisionsToShow) {
		var revision = new Revision(data);
		tbody.appendChild(revision.element);
	} else {
		revisionsBuffer.push(data);
		setSummary();
	}
}

function setSummary(){
	var summary = document.getElementById('pending-revisions-summary');

	summary.innerHTML = 'and ' + revisionsBuffer.length + ' more';
}

var revisingEntities = {};

function Revision(data){
	var element = this.element = document.createElement('tr'),
			sourceTableCell = document.createElement('td'),
			modifyTableCell = document.createElement('td'),
			resultTableCell = document.createElement('td'),
			sourceTable = document.createElement('table'),
			modifyItems = document.createElement('ul'),
			resultItems = document.createElement('ul'),
			rejectAllButton = document.createElement('button'),
			approveAllButton = document.createElement('button');

	sourceTableCell.appendChild(sourceTable);
	element.appendChild(sourceTableCell);
	element.appendChild(modifyTableCell);
	element.appendChild(resultTableCell);

	rejectAllButton.className = 'reject-all';
	approveAllButton.className = 'approve-all';
	approveAllButton.setAttribute("disabled", true);
	rejectAllButton.innerHTML = 'Reject all';
	approveAllButton.innerHTML = 'Approve all';

	modifyTableCell.appendChild(modifyItems);

	resultTableCell.appendChild(resultItems);

	resultTableCell.appendChild(rejectAllButton);

	resultTableCell.appendChild( approveAllButton );

	element.dataset.revisionId = data.revisionId;
	
	Object.keys( data.sourceData ).forEach( createSourceRow );

	data.entities.forEach( createModifyFieldsAndResultForEntity );

	revisionItems[data.revisionId] = data;

	return;

	function createSourceRow( key ){
		var value = data.sourceData[key],
				tr = document.createElement('tr'),
				td1 = document.createElement('td'),
				td2 = document.createElement('td');

		td1.innerHTML = key;
		td2.innerHTML = value;

		tr.appendChild( td1 );
		tr.appendChild( td2 );

		sourceTable.appendChild( tr );
	}

	function createModifyFieldsAndResultForEntity( entity, i ){
		var schema = entity.schema,
				key = entity.key,
				modifyItem = document.createElement('li'),
				resultItem = document.createElement('ul'),
				modifyTable = document.createElement('table'),
				resultTable = document.createElement('table');

		modifyItem.appendChild(modifyTable);
		resultItem.appendChild(resultTable);

		modifyItem.className = 'modifiableItem';
		resultItem.className = 'resultItem';
		modifyItem.dataset.key = resultItem.dataset.key = key;

		if( validator.validate(entity.originalValues, entity.schema ) ) resultItem.classList.add( 'valid' );
		else resultItem.classList.add( 'invalid' );

		modifyItems.appendChild(modifyItem);
		resultItems.appendChild(resultItem);

		revisingEntities[key] = entity;

		entity.requiredKeys.forEach( createKeyRow );

		return;

		function createKeyRow( key ) {
			var value = entity.originalValues[key],
					modifyTr = document.createElement('tr'),
					resultTr = document.createElement('tr'),
					modifyLabelTd = document.createElement('td'),
					modifyInputTd = document.createElement('td'),
					resultLabelTd = document.createElement('td'),
					resultValueTd = document.createElement('td'),
					label = document.createElement('label'),
					input = document.createElement('input');

			modifyTr.appendChild( modifyLabelTd );
			modifyTr.appendChild( modifyInputTd );

			resultTr.appendChild( resultLabelTd );
			resultTr.appendChild( resultValueTd );

			modifyLabelTd.appendChild(label);
			modifyInputTd.appendChild(input);

			label.innerHTML = key;
			if(value) input.value = value;

			resultLabelTd.innerHTML = key;
			if(value) resultValueTd.innerHTML = value;

			modifyTable.appendChild(modifyTr);
			resultTable.appendChild(resultTr);

			var isRequired = ~schema.required.indexOf(key),
					isHidden = schema.hidden && ~schema.hidden.indexOf( key ),
					isFixed = schema.fixed && ~schema.fixed.indexOf( key );

			if(isRequired && !isFixed){
				label.innerHTML += '*';
			}
			if(isHidden){
				modifyTr.classList.add('hidden');
				resultTr.classList.add('hidden');
			}
			if(isFixed){
				input.disabled = 'disabled';
				modifyTr.classList.add('disabled');
				resultTr.classList.add('disabled');
			}

			input.classList.add( 'modify' );
			input.dataset.key = key;
			resultValueTd.dataset.key = key;
		}
	}
}

function sendRevisions(revisionElement, method){
	var revisionId = revisionElement.dataset.revisionId,
			revisionSet = revisionItems[revisionId];

	if(method === 'dismiss'){
		return socket.emit('dismiss', { socketKey: socketKey, revisionId: revisionId });
	}

	var results = {};

	revisionSet.entities.forEach( addResult );

	socket.emit('rectify', {
		socketKey: socketKey,
		revisionId: revisionId,
		entities: results
	});

	function addResult( entity ) {
		results[entity.key] = entity.currentValues;
	}
}

function removeRevision(revisionId){

	var element = document.querySelector('tr[data-revision-id="' + revisionId + '"]'),
			tbody = element.bbQuerySelectorParent('tbody');

	if(!element) {
		console.log('element not found: ' + revisionId);
		return;
	}

	element.remove();

	var nextRevisionData = revisionsBuffer.shift();

	if(!nextRevisionData) return; //todo make nicer message
	
	var nextRevision = new Revision(nextRevisionData);

	tbody.appendChild(nextRevision.element);

	setSummary();
}

function handleComplete(results){
	var summary = document.getElementById('pending-revisions-summary');
	if(results.error) {
		summary.innerHTML = results.error;
		return;
	}
	
	var hrefs = results.files.map( createFileLinks ),
			lis = hrefs.map(embedInLi);

	var table = document.querySelector('#pending-revisions > table'),
			parentNode = table.parentNode;

	parentNode.innerHTML = 'Transformation complete';

	var ul = document.createElement('ul');
	lis.forEach( ul.appendChild.bind(ul) );
	
	parentNode.appendChild(ul);

	return;

	function createFileLinks(file){
		var span = document.createElement('span'),
				aDownload = document.createElement('a'),
				aView = document.createElement('a'),
				filename = file.split('/').pop();

		span.innerHTML = filename;

		aDownload.href = aView.href = file;
		aDownload.innerHTML = 'Download';
		aDownload.download = filename;
		aView.innerHTML = 'View';
		aView.target = '_blank';

		span.appendChild(aDownload);
		span.appendChild(aView);
		return span;
	}

	function embedInLi(element){
		var li = document.createElement('li');
		li.appendChild(element);
		return li;
	}
}
