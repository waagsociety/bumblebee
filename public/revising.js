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

  if( schemaProperty.type === 'number' ) value = +value;
  
  resultValueElement.innerHTML = value;

  resolveOnObject(entity.currentValues, this.dataset.path, value );

  validateItem( entity.currentValues, entity.schema, resultItem );
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

  validateItem( entity.currentValues, entity.schema, resultItem );
}

function validateItem( values, schema, resultItem ){
  if( validator.validate( values, schema ) ) {
    resultItem.classList.add('valid');
    resultItem.classList.remove('invalid');
  } else {
    resultItem.classList.add('invalid');
    resultItem.classList.remove('valid');
    resultItem.classList.remove('approved');
  }

  console.log(validator.getLastErrors());

  updateApproveAllButton();
}

function updateApproveAllButton(){
  var invalidItems = document.querySelectorAll( '.resultItem.invalid' ),
      approveAllButton = document.querySelector( '.approve-all' );

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
      sourceTable = document.createElement( 'table' ),
      modifyItems = document.createElement( 'ul' ),
      resultItems = document.createElement( 'ul' ),
      rejectAllButton = document.createElement( 'button' ),
      approveAllButton = document.createElement( 'button' ),
      errorList = document.createElement( 'ul' );

  rejectAllButton.className = 'reject-all';
  approveAllButton.className = 'approve-all';
  approveAllButton.setAttribute( 'disabled', true );
  rejectAllButton.innerHTML = 'Reject all';
  approveAllButton.innerHTML = 'Approve all';

  errorList.className = 'errors';

  sourceTableCell.appendChild( sourceTable );
  sourceTableCell.appendChild( errorList );
  element.appendChild( sourceTableCell );
  element.appendChild( modifyTableCell );
  element.appendChild( resultTableCell );

  modifyTableCell.appendChild( modifyItems );

  resultTableCell.appendChild( rejectAllButton );

  resultTableCell.appendChild( approveAllButton );

  resultTableCell.appendChild( resultItems );


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
        modifyTitle = document.createElement('h5'),
        resultTitle = document.createElement('h5'),
        modifyTable = document.createElement('table'),
        resultTable = document.createElement('table');

    modifyItem.appendChild(modifyTitle);
    resultItem.appendChild(resultTitle);
    resultItem.innerHTML = modifyTitle.innerHTML = schema.description;

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

    entity.requiredKeys.forEach( createKeyRow.bind( null, entity.originalValues, '' ) );

    if( entity.errors ) Object.keys( entity.errors ).forEach( addTransformationError );
    if( entity.validationErrors ) Object.keys( entity.validationErrors ).forEach( addValidationError );

    return;

    function createKeyRow( originalValues, path, key ) {
      var value = originalValues[key],
          isISODateResults = dateISOStringRegExp.exec( value ),
          propertyPath = path ? path + '.' + key : key,
          schemaProperty = resolveOnObject(schema.properties, propertyPath);

      if(typeof value === 'object' && value !== null ){
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
          input;

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

      label.innerHTML = propertyPath;
      if(value) input.value = value;

      resultLabelTd.innerHTML = key;
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
        input.valueAsDate = value;
        resultValueTd.innerHTML = value.toISOString();
      }

      if( schemaProperty ) {
        if( schemaProperty.type && schemaProperty.type === 'number' ) {
          input.type = 'number';
        }
      }

      input.classList.add( 'modify' );
      input.dataset.path = propertyPath;
      resultValueTd.dataset.path = propertyPath;
    }

    function addTransformationError( key ){
      var error = entity.errors[ key ],
          li = document.createElement('li');

      li.innerHTML = key + ': ' + error;
      
      errorList.appendChild( li );
    }

    function addValidationError( key ){
      var error = entity.validationErrors[ key ],
          li = document.createElement('li');
      li.innerHTML = error.stack;
      
      errorList.appendChild( li );
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
