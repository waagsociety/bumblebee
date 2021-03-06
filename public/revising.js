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
      '.approve-all': { click: approveAll },
      '#force-complete': { click: handleForceCompleteClick }
    },
    socketHandlers = {
      'requestedit': createRevisionJob,
      'remove': removeRevision,
      'status': displayStatus,
      'complete': handleComplete,
      'loadscript': loadScript,
      'custom': customMessageHandler
    };

// copy revisionHandlers over to eventHandlers
revisionHandlers.forEach( function( selector, handlers ){
  eventHandlers[ selector ] = handlers;
} );

/**
 * Enables socket.io connection and binds socket handlers
 */
function initConnection(){
  if( !window.io ) return;

  socket = io();

  var keyContainer = document.getElementById( 'socketkey' );
  
  socketKey = keyContainer && keyContainer.dataset.socketkey;
  
  // couples the socket connection with a bucket on the server, owned by a specific transformation process
  socket.emit('socketkey', socketKey);

  // bind socket handlers
  socketHandlers.forEach( socket.on.bind( socket ) );

  // declares sendCustomMessage for use by consumers
  window.sendCustomMessage = function( type, data ){
    var transportObject = { socketKey: socketKey, type: type };
    if( data !== undefined ) transportObject.data = data;
    socket.emit( 'custom', transportObject );
  };
}

var customMessageHandlers = {};
/**
 * when a custom message comes in, it checks the customMessageHandlers object for the message.type,
 * if it exists calls it with message.data
 */
function customMessageHandler(message){
  if(message.type in customMessageHandlers) customMessageHandlers[message.type](message.data);
  else console.log(message);
}

/**
 * used for dynamically injecting scripts from consumer side
 * to do so, from postprocessor: `bucket.loadScript( '/relations.js' );` will try to get relations.js from consumer public folder
 */
function loadScript(path){
  var script = document.createElement( 'script' );
  script.src = path;
  document.head.appendChild(script);
}

/**
 * Changes color of result item
 */
function toggleResultStatus(e){
  this.classList.toggle('valid');
  this.classList.toggle('approved');
}

/**
 * dismisses all entities from this csv row
 */
function rejectAll(e){
  sendRevisions( document.querySelector('[data-revision-id]'), 'dismiss' );
}

/**
 * if entities are valid posts them to the server
 */
function approveAll(e){
  var invalidItems = document.querySelectorAll( '.resultItem.invalid' );

  if( !invalidItems.length ){
    sendRevisions( document.querySelector('[data-revision-id]') );
  }
}

/**
 * Handles key presses in form fields,
 * responsible for sending with enter,
 * rejecting with escape key
 * syncing the result entities with the form elements
 * validating the entities
 */
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

  if( value ) {
    if( schemaProperty && schemaProperty.type === 'number' ) value = +value;
    
    resultValueElement.innerHTML = value;

    resolveOnObject( entity.currentValues, this.dataset.path, value );
  } else {
    unsetOnObject( entity.currentValues, this.dataset.path );
  }


  validateItem( entity.currentValues, entity.schema, this, resultItem );
}

/**
 * Same as previous but for date fields
 */
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

/**
 * Sends signal to server to continue with all currently processed entities,
 * leaving the ones to be processed behind
 */
function handleForceCompleteClick( e ) {
  if( confirm( text.transform.forceCompleteConfirmation ) ) {
    forceComplete();
    this.remove();
  }
}

/**
 * validates item and changes color of entity to show this status,
 * also sets red border on input if it's invalid
 */
function validateItem( item, schema, input, resultItem ){
  if( validator.validate( item, schema ) ) {
    resultItem.classList.add('valid');
    resultItem.classList.remove('invalid');
  } else {
    resultItem.classList.add('invalid');
    resultItem.classList.remove('valid');
    resultItem.classList.remove('approved');
  }

  var errors = validator.getLastErrors();

  if( input ) {
    if( !errors ) input.removeAttribute( 'isvalid' );
    else{
      errors.forEach( function( error ){
        if( error.path.slice( 2 ) === input.dataset.path ) input.setAttribute( 'isvalid', false );
      } );
    }
  }

  updateApproveAllButton();
}

/**
 * enables or disables approve all button based on the presence of invalid entities
 */
function updateApproveAllButton(){
  var invalidItems = document.querySelectorAll( '.resultItem.invalid' ),
      approveAllButton = document.querySelector( 'button.approve-all' );

  if( !invalidItems.length ) approveAllButton.removeAttribute( 'disabled' );
  else approveAllButton.setAttribute( 'disabled', true );
}

/**
 * triggers when new revisions are added to the DOM, focuses on first empty input
 */
function requestAdded( e ){
  var firstEmptyElement;
  if( e.target.querySelectorAll ) Array.prototype.forEach.call( e.target.querySelectorAll( 'input' ), checkIfIsFirstEmptyInput );

  function checkIfIsFirstEmptyInput( element ){
    if( !firstEmptyElement && !element.value ) firstEmptyElement = element;
  }

  if( firstEmptyElement ) firstEmptyElement.focus();
}

/**
 * creates on-screen elements and data containers for a revision job
 * enables/disables approve button depending on entities' validity
 */
function createRevisionJob(data){
  var tbody = document.querySelector('#pending-revisions tbody'),
      revision = new Revision(data);

  tbody.appendChild(revision.element);

  // validate because maybe they are valid already (caused by markNextAsInvalid)
  revisingEntities.forEach( function( key, entity ) {
    validateItem( entity.currentValues, entity.schema, null, document.querySelector( '[data-key="' + key + '"]' ) );
  } );

  updateApproveAllButton();
}

var revisingEntities;

/**
 * creates screen element for revisions
 */
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
      approveAllButton = document.querySelector( 'button.approve-all' );

  revisingEntities = {};

  // var errorContainer = document.createElement( 'div' ),
  //     errorTitle = document.createElement( 'h4' );

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
  
  data.sourceData.forEach( createSourceRow );

  data.entities.forEach( createModifyFieldsAndResultForEntity );

  revisionItems[data.revisionId] = data;

  // if( errorContainer.children ){
  //   errorTitle.innerHTML = text.transform.thereAreErrors;
  //   errorContainer.classList.add( 'error-container' );
  //   errorContainer.insertBefore( errorTitle, errorContainer.firstChild );
  //   sourceTableCell.appendChild( errorContainer );
  // }

  return;

  function createSourceRow( key, value ){
    var tr = document.createElement('tr'),
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
        mapping = entity.mapping,
        key = entity.key,
        properties = Object.keys( mapping ).sort( function( a, b ) {
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
    resultTitle.innerHTML = modifyTitle.innerHTML = mapping.bb_description || schema.description;

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

    // if( /*( entity.errors && Object.keys( entity.errors ).length ) ||*/ ( entity.validationErrors && entity.validationErrors.length ) ){
    //   errorItem = document.createElement( 'div' );
    //   errorItem.className = 'errorItem';
    //   errorTitle = document.createElement( 'h5' );
    //   errorTitle.innerText = schema.description;
    //   errorItem.appendChild( errorTitle );
      
    //   errorTable = document.createElement( 'table' );

    //   if( entity.errors ) Object.keys( entity.errors ).forEach( addTransformationError );
    //   if( entity.validationErrors && entity.validationErrors.length ) entity.validationErrors.forEach( addValidationError );

    //   errorItem.appendChild( errorTable );

    //   errorContainer.appendChild( errorItem );
    // }

    return;

    function createKeyRow( originalValues, path, key ) {
      if( [
        'bb_subProperty',
        'bb_order',
        'bb_entityType',
        'bb_skipCondition',
        'bb_splitCondition',
        'bb_description'
      ].indexOf( key ) > -1 ) return;

      var value = originalValues[key],
          isISODateResults = dateISOStringRegExp.exec( value ),
          propertyPath = path ? path + '.' + key : key,
          schemaProperty = resolveOnObject(schema.properties, propertyPath);

      // recurse into subprop if it is a true subproperty
      if(typeof value === 'object' && value !== null && ( schemaProperty && ( !schemaProperty.type || schemaProperty.type !== 'string' ) ) ){
        return Object.keys( resolveOnObject( mapping, propertyPath ) ).sort( function( a, b ) {
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

        var enums = schemaProperty['enum'],
            selected;

        enums.forEach( function createOption( optionValue ) {
          var option = document.createElement('option');
          option.value = optionValue;
          option.label = optionValue;

          if( optionValue === value ) {
            option.setAttribute( 'selected', true );
            selected = true;
          }

          input.appendChild(option);
        } );

        if( !selected ) {
          var defaultOption = document.createElement( 'option' );
          defaultOption.value = '';
          defaultOption.disabled = true;
          defaultOption.label = 'please select';
          defaultOption.setAttribute( 'selected', true );

          input.insertBefore( defaultOption, input.firstChild );
        }

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

      var isRequired = schema.required && ~schema.required.indexOf( key ),
          isHidden = schema.hidden && ~schema.hidden.indexOf( key ),
          isFixed = schema.fixed && ~schema.fixed.indexOf( key );

      // check schema oneOf required clauses
      if( !isRequired && schema.oneOff ) {
        schema.oneOff.forEach( setIsRequired );
      }

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

    function setIsRequired( valueHolder ) {
      isRequired = isRequired || ~valueHolder.required.indexOf( key );
    }

    function addTransformationError( key ){
      addError( key, entity.errors[ key ] );
    }

    function addValidationError( error ){
      addError( error.property.slice( 9 ), error.message );
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

/**
 * Sends revisions to the server
 */
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

/**
 * Sends signal to server to continue to postprocessing,
 * leaving all to be revised entities behind
 */
function forceComplete(){
  socket.emit( 'force-complete', { socketKey: socketKey } );
}

/**
 * removes revision element from DOM
 */
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
}

var progress = {};

/**
 * shows csv rows autodone, manualdone and to do
 */
function displayStatus( statusUpdate ) {
  var revisionsTable;

  //console.log('status:', statusUpdate);
  Object.keys( statusUpdate ).forEach( setOnStatus );

  [ 'sourceItemsAutoProcessed', 'sourceItemsReceived', 'sourceItemsWaiting' ].forEach( setWidth );

  if( progress.sourceItemsTotal === progress.sourceItemsReceived + progress.sourceItemsAutoProcessed ){
    revisionsTable = document.querySelector('#pending-revisions table');
    if( revisionsTable) revisionsTable.remove();
  }

  document.getElementById('percentage-done').innerHTML = ( ( ( progress.sourceItemsAutoProcessed + ( progress.sourceItemsReceived || 0 ) ) / progress.sourceItemsTotal ) * 100 ).toFixed( 0 ) + '%';

  return;

  function setOnStatus( key ){
    progress[ key ] = statusUpdate[ key ];
  }

  function setWidth( key ){
    if( statusUpdate[key] === undefined && !statusUpdate.sourceItemsTotal ) return;
    var value = progress[ key ] || 0;

    document.getElementById( key.toLowerCase() ).style.width = ( value / progress.sourceItemsTotal ) * 100 + '%';
    document.getElementById( 'numerical-' + key.toLowerCase() ).innerHTML = value;
  }
}

/**
 * removes complete buttons, shows download links
 */
function handleComplete(results){
  var completeBtn = document.getElementById( 'force-complete' );
  if( completeBtn ) completeBtn.remove();

  var summary = document.getElementById( 'pending-revisions-summary' );
  if( results.error ) {
    summary.innerHTML = results.error;
    return;
  }
  
  var hrefs = results.files.map( createFileLinks ),
      lis = hrefs.map( embedInLi );

  var pendingRevisions = document.querySelector( '#pending-revisions' );

  pendingRevisions.innerHTML = '';
  document.querySelector( 'header.transformation-header h1' ).innerHTML = 'Transformation complete!';

  var ul = document.createElement( 'ul' );
  lis.forEach( ul.appendChild.bind( ul ) );
  
  pendingRevisions.appendChild( ul );

  return;

  function createFileLinks( file ){
    var span = document.createElement( 'span' ),
        aDownload = document.createElement( 'a' ),
        aView = document.createElement( 'a' ),
        filename = file.split( '/' ).pop(),
        extension = filename.split( '.' ).pop();

    span.innerHTML = filename;

    aDownload.href = aView.href = file;
    aDownload.innerHTML = 'Download';
    aDownload.download = filename;
    aView.innerHTML = 'View';
    aView.target = '_blank';

    if( extension !== 'json' && extension !== 'csv' ) {
      aView.href += '?raw=true';
    }

    span.appendChild( aDownload );
    span.appendChild( aView );
    return span;
  }

  function embedInLi( element ){
    var li = document.createElement( 'li' );
    li.className = 'transformation-result';
    li.appendChild( element );
    return li;
  }
}
