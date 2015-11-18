// http://stackoverflow.com/questions/3143070/javascript-regex-iso-datetime
var dateISOStringRegExp = /(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d\.\d+([+-][0-2]\d:[0-5]\d|Z))|(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d([+-][0-2]\d:[0-5]\d|Z))|(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d([+-][0-2]\d:[0-5]\d|Z))/,
    maxRevisionsToShow = 1,
    revisionsBuffer = [],
    revisionItems = {},
    validator;

var revisionHandlers = { '#pending-revisions': { DOMNodeInserted: requestAdded },
      'input.modify': { keyup: handleModifyKeyUp },
      'input[type=date]': { change: handleModifyDateChange },
      'select.modify': { change: handleModifyKeyUp },
      '.resultItem.valid, .resultItem.approved': { click: toggleResultStatus },
      '.reject-all': { click: rejectAll },
      '.approve-all': { click: approveAll }
    };

Object.keys( revisionHandlers ).forEach( function( selector ){
  eventHandlers[selector] = revisionHandlers[selector];
} );

function initConnection(){
  if( !window.io ) return;

  socket = io();

  var keyContainer = document.getElementById('socketkey');
  
  socketKey = keyContainer && keyContainer.dataset.socketkey;
  
  socket.emit('socketkey', socketKey);

  socket.on('requestedit', createRevisionJob);

  socket.on('remove', removeRevision);

  socket.on('status', displayStatus);

  socket.on('complete', handleComplete);

  socket.on('loadscript', loadScript);

  socket.on('custom', customMessageHandler);

  window.sendCustomMessage = function( type, data ){
    var transportObject = { socketKey: socketKey, type: type };
    if( data !== undefined ) transportObject.data = data;
    socket.emit( 'custom', transportObject );
  };
}

var customMessageHandlers = {};

function customMessageHandler(message){
  if(message.type in customMessageHandlers) customMessageHandlers[message.type](message.data);
  else console.log(message);
}

function loadScript(path){
  var script = document.createElement( 'script' );
  script.src = path;
  document.head.appendChild(script);
}

function toggleResultStatus(e){
  this.classList.toggle('valid');
  this.classList.toggle('approved');
}

function rejectAll(e){
  sendRevisions( document.querySelector('[data-revision-id]'), 'dismiss' );
}

function approveAll(e){
  var invalidItems = document.querySelectorAll( '.resultItem.invalid' );

  if( !invalidItems.length ){
    sendRevisions( document.querySelector('[data-revision-id]') );
  }
}

function handleModifyKeyUp(e){
  if(this.type && this.type === 'date') return;

  if( e.keyCode === 13 ) { //enter
    return approveAll(e);
  }

  if(e.keyCode === 27 ) { //escape
    return rejectAll(e);
  }

  var modifyItem = this.bbQuerySelectorParent( '.modifiableItem' ),
      entity = revisingEntities[modifyItem.dataset.key],
      resultItem = modifyItem && document.querySelector( '.resultItem[data-key=' + modifyItem.dataset.key + ']' ),
      resultValueElement = resultItem.querySelector('td[data-path=' + this.dataset.path.replace('.', '\\.') + ']' ),
      schemaProperty = resolveOnObject( entity.schema.properties, this.dataset.path ),
      value = this.value;

  if( schemaProperty && schemaProperty.type === 'number' ) value = +value;
  
  resultValueElement.innerHTML = value;

  resolveOnObject(entity.currentValues, this.dataset.path, value );

  validateItem( entity.currentValues, entity.schema, this, resultItem );
}

function handleModifyDateChange(e){
  var modifyItem = this.bbQuerySelectorParent( '.modifiableItem' ),
      entity = revisingEntities[modifyItem.dataset.key],
      resultItem = modifyItem && document.querySelector( '.resultItem[data-key=' + modifyItem.dataset.key + ']' ),
      resultValueElement = resultItem.querySelector('td[data-path=' + this.dataset.path.replace('.', '\\.') + ']' ),
      valueAsDate = new Date( this.value ),
      isoString = valueAsDate.toISOString();

  resultValueElement.innerHTML = valueAsDate.toString();

  resolveOnObject(entity.currentValues, this.dataset.path, isoString );

  validateItem( entity.currentValues, entity.schema, this, resultItem );
}

function validateItem( values, schema, input, resultItem ){
  if( validator.validate( values, schema ) ) {
    resultItem.classList.add('valid');
    resultItem.classList.remove('invalid');
  } else {
    resultItem.classList.add('invalid');
    resultItem.classList.remove('valid');
    resultItem.classList.remove('approved');
  }

  var errors = validator.getLastErrors();

  if( !errors ) input.removeAttribute( 'isvalid' );
  else{
    errors.forEach( function( error ){
      if( error.path.slice( 2 ) === input.dataset.path ) input.setAttribute( 'isvalid', false );
    } );
  }

  updateApproveAllButton();
}

function updateApproveAllButton(){
  var invalidItems = document.querySelectorAll( '.resultItem.invalid' ),
      approveAllButton = document.querySelector( 'button.approve-all' );

  if( !invalidItems.length ) approveAllButton.removeAttribute( 'disabled' );
  else approveAllButton.setAttribute( 'disabled', true );
}

function requestAdded(e){
  var firstEmptyElement;
  e.target.querySelectorAll && Array.prototype.forEach.call(e.target.querySelectorAll('input'), checkIfIsFirstEmptyInput);

  function checkIfIsFirstEmptyInput(element){
    if( !firstEmptyElement && !element.value ) firstEmptyElement = element;
  }

  if(firstEmptyElement) firstEmptyElement.focus();
}

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
  var element = this.element = document.createElement( 'tr' ),
      sourceTableCell = document.createElement( 'td' ),
      modifyTableCell = document.createElement( 'td' ),
      resultTableCell = document.createElement( 'td' ),
      sourceItem = document.createElement( 'div' ),
      sourceTitle = document.createElement( 'h5' ),
      sourceTable = document.createElement( 'table' ),
      modifyItems = document.createElement( 'ul' ),
      resultItems = document.createElement( 'ul' ),
      rejectAllButton = document.createElement( 'button' ),
      approveAllButton = document.querySelector( 'button.approve-all' ),
      errorContainer = document.createElement( 'div' ),
      errorTitle = document.createElement( 'h4' );

  approveAllButton.setAttribute( 'disabled', true );

  sourceItem.className = 'sourceItem';
  sourceTitle.innerText = text.transform.sourceTitle;
  sourceItem.appendChild( sourceTitle );
  sourceItem.appendChild( sourceTable );
  sourceTableCell.appendChild( sourceItem );

  element.appendChild( sourceTableCell );
  element.appendChild( modifyTableCell );
  element.appendChild( resultTableCell );

  modifyTableCell.appendChild( modifyItems );

  resultTableCell.appendChild( resultItems );


  element.dataset.revisionId = data.revisionId;
  
  Object.keys( data.sourceData ).forEach( createSourceRow );

  data.entities.forEach( createModifyFieldsAndResultForEntity );

  revisionItems[data.revisionId] = data;

  if( errorContainer.children ){
    errorTitle.innerHTML = text.transform.thereAreErrors;
    errorContainer.classList.add( 'error-container' );
    errorContainer.insertBefore( errorTitle, errorContainer.firstChild );
    sourceTableCell.appendChild( errorContainer );
  }

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
        properties = Object.keys( entity.mapping ).sort( function( a, b ) {
          return a.bb_order - b.bb_order;
        } ),
        modifyItem = document.createElement('li'),
        resultItem = document.createElement('ul'),
        modifyTitle = document.createElement('h5'),
        resultTitle = document.createElement('h5'),
        modifyTable = document.createElement('table'),
        resultTable = document.createElement('table'),
        errorItem,
        errorTitle,
        errorTable;

    modifyItem.appendChild(modifyTitle);
    resultItem.appendChild(resultTitle);
    resultTitle.innerHTML = modifyTitle.innerHTML = schema.description;

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

    properties.forEach( createKeyRow.bind( null, entity.originalValues, '' ) );

    if( /*( entity.errors && Object.keys( entity.errors ).length ) ||*/ ( entity.validationErrors && entity.validationErrors.length ) ){
      errorItem = document.createElement( 'div' );
      errorItem.className = 'errorItem';
      errorTitle = document.createElement( 'h5' );
      errorTitle.innerText = schema.description;
      errorItem.appendChild( errorTitle );
      
      errorTable = document.createElement( 'table' );

      if( entity.errors ) Object.keys( entity.errors ).forEach( addTransformationError );
      if( entity.validationErrors && entity.validationErrors.length ) entity.validationErrors.forEach( addValidationError );

      errorItem.appendChild( errorTable );

      errorContainer.appendChild( errorItem );
    }

    return;

    function createKeyRow( originalValues, path, key ) {
      if( [
        'bb_subProperty',
        'bb_order',
        'bb_entityType',
        'bb_skipCondition',
        'bb_splitCondition'
      ].indexOf( key ) > -1 ) return;

      var value = originalValues[key],
          isISODateResults = dateISOStringRegExp.exec( value ),
          propertyPath = path ? path + '.' + key : key,
          schemaProperty = resolveOnObject(schema.properties, propertyPath);

      if(typeof value === 'object' && value !== null ){
        return Object.keys( resolveOnObject( entity.mapping, propertyPath ) ).sort( function( a, b ) {
          return a.bb_order - b.bb_order;
        }).forEach( createKeyRow.bind( null, value, propertyPath ) );
        return Object.keys( value ).forEach( createKeyRow.bind( null, value, propertyPath ) );
      }

      if( isISODateResults ) value = new Date( value );

      var modifyTr = document.createElement('tr'),
          resultTr = document.createElement('tr'),
          modifyLabelTd = document.createElement('td'),
          modifyInputTd = document.createElement('td'),
          resultLabelTd = document.createElement('td'),
          resultValueTd = document.createElement('td'),
          label = document.createElement('label'),
          input, tooltip;

      if(schemaProperty && schemaProperty['enum'] ){
        input = document.createElement('select');

        var enums = schemaProperty['enum'];

        enums.forEach( function createOption( optionValue ) {
          var option = document.createElement('option');
          option.value = optionValue;
          option.label = optionValue;

          if( optionValue === value ) option.setAttribute( 'selected', true );

          input.appendChild(option);
        } );

        if(enums.length === 1){
          input.disabled = 'disabled';
        }
      } else {
        input = document.createElement('input');
        input.placeholder = !schemaProperty ? '' : schemaProperty.description;
      }

      modifyTr.appendChild( modifyLabelTd );
      modifyTr.appendChild( modifyInputTd );

      resultTr.appendChild( resultLabelTd );
      resultTr.appendChild( resultValueTd );

      modifyLabelTd.appendChild( label );
      modifyInputTd.appendChild( input );

      if( schemaProperty && schemaProperty.descriptionLong ){
        tooltip = document.createElement( 'span' );
        tooltip.className = 'tooltip-shower';
        tooltip.dataset.tooltip = schemaProperty.descriptionLong;
        tooltip.innerText = 'i';
        modifyInputTd.appendChild( tooltip );
      }

      label.innerHTML = propertyPath;
      if(value) input.value = value;

      resultLabelTd.innerHTML = propertyPath;
      if(value) resultValueTd.innerHTML = value;

      modifyTable.appendChild( modifyTr );
      resultTable.appendChild( resultTr );

      var isRequired = ~schema.required.indexOf( key ),
          isHidden = schema.hidden && ~schema.hidden.indexOf( key ),
          isFixed = schema.fixed && ~schema.fixed.indexOf( key );

      if( isRequired && !isFixed ){
        label.innerHTML += '*';
      }
      if( isHidden ){
        modifyTr.classList.add( 'hidden' );
        resultTr.classList.add( 'hidden' );
      }
      if( isFixed ){
        input.disabled = 'disabled';
        modifyTr.classList.add( 'disabled' );
        resultTr.classList.add( 'disabled' );
      }

      if( value instanceof Date ) {
        input.setAttribute( 'type', 'date' );
        try{
          input.valueAsDate = value;
        } catch(e){
          input.value = value.toString();
        }

        resultValueTd.innerHTML = value.toISOString();
      }

      if( schemaProperty ) {
        if( schemaProperty.type && schemaProperty.type === 'number' ) {
          input.type = 'number';
        }

        if( isRequired && key in entity.errors ){
          input.setAttribute( 'isvalid', false );
        }
      }

      input.classList.add( 'modify' );
      input.dataset.path = propertyPath;
      resultValueTd.dataset.path = propertyPath;
    }

    function addTransformationError( key ){
      addError( key, entity.errors[ key ] );
    }

    function addValidationError( error ){
      addError( error.property.slice(9), error.message );
    }

    function addError( key, message ){
      var tr = document.createElement( 'tr' ),
          keyTd = document.createElement( 'td' ),
          messageTd = document.createElement( 'td' );

      keyTd.innerText = key;
      messageTd.innerText = message;

      tr.appendChild( keyTd );
      tr.appendChild( messageTd );

      errorTable.appendChild( tr );
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

var progress = {};

function displayStatus( statusUpdate ) {
  //console.log('status:', statusUpdate);
  Object.keys( statusUpdate ).forEach( setOnStatus );

  ['sourceItemsAutoProcessed', 'sourceItemsReceived', 'sourceItemsWaiting'].forEach( setWidth );

  if( progress.sourceItemsTotal === progress.sourceItemsReceived + progress.sourceItemsAutoProcessed ){
    document.querySelector('#pending-revisions table').remove();
  }

  document.getElementById('percentage-done').innerHTML = ( ( ( progress.sourceItemsAutoProcessed + ( progress.sourceItemsReceived || 0 ) ) / progress.sourceItemsTotal ) * 100 ).toFixed( 0 ) + '%';

  return;

  function setOnStatus( key ){
    progress[ key ] = statusUpdate[ key ];
  }

  function setWidth( key ){
    if( !statusUpdate[key] && !statusUpdate.sourceItemsTotal ) return;
    var value = progress[ key ] || 0;

    document.getElementById( key.toLowerCase() ).style.width = ( value / progress.sourceItemsTotal ) * 100 + '%';
    document.getElementById( 'numerical-' + key.toLowerCase() ).innerHTML = value;
  }
}

function handleComplete(results){
  var summary = document.getElementById('pending-revisions-summary');
  if(results.error) {
    summary.innerHTML = results.error;
    return;
  }
  
  var hrefs = results.files.map( createFileLinks ),
      lis = hrefs.map(embedInLi);

  var pendingRevisions = document.querySelector('#pending-revisions');

  pendingRevisions.innerHTML = '';
  document.querySelector('header.transformation-header h1').innerHTML = 'Transformation complete!';

  var ul = document.createElement('ul');
  lis.forEach( ul.appendChild.bind(ul) );
  
  pendingRevisions.appendChild(ul);

  return;

  function createFileLinks(file){
    var span = document.createElement('span'),
        aDownload = document.createElement('a'),
        aView = document.createElement('a'),
        filename = file.split('/').pop(),
        extension = filename.split('.').pop();

    span.innerHTML = filename;

    aDownload.href = aView.href = file;
    aDownload.innerHTML = 'Download';
    aDownload.download = filename;
    aView.innerHTML = 'View';
    aView.target = '_blank';

    if( extension !== 'json' && extension !== 'csv' ) {
      aView.href += '?raw=true';
    }

    span.appendChild(aDownload);
    span.appendChild(aView);
    return span;
  }

  function embedInLi(element){
    var li = document.createElement('li');
    li.className = 'transformation-result';
    li.appendChild(element);
    return li;
  }
}
