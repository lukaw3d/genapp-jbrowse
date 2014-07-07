'use strict';

// CONSTANTS
var API_DATA_URL = '/api/v1/data/';

// DIRECTIVES
angular.module('jbrowse.directives', ['genjs.services'])
    .value('version', '0.1')

    .directive('genBrowser', ['notify', function (notify) {
        /**
         *  .. js::attribute:: genBrowser
         *
         *      :js:attr:`genBrowser` renders JBrowse genome browser
         *
         *      Usage example:
         *
         *      .. code-block:: html
         *
         *          <gen-browser gen-browser-options="options">
         *
         *      Options varaibles:
         *      :gen-browser-options: dict of JBrowse options and callbacks
         *
         *      Fields:
         *      :config:        JBrowse config object.
         *      :size:          Height of JBrowse window. "auto" / amount in px.
         *      :onConnect:     On JBrowse initialize callback.
         *      :afterAdd:      Dict with data types as keys and callback functions as values. Callback is executed after
         *                      given data type is added to the browser.
         *
         *      API:
         *      :js:func:`addTrack`
         *          :param Object item: Genesis data item.
         *      :js:func:`removeTracks`
         *          :param Array labels: Tracks labels or track objects to delete.
         */

        return {
            restrict: 'E',
            scope: {
                genBrowserOptions: '='
            },
            replace: true,
            templateUrl: '/static/genapp-jbrowse/partials/directives/genbrowser.html',
            controller: ['$scope', '$q', 'notify', 'genBrowserId', function ($scope, $q, notify, genBrowserId) {
                var typeHandlers,
                    addTrack,
                    reloadRefSeqs,
                    preConnect,
                    connector,
                    getTrackByLabel;

                $scope.config = $scope.genBrowserOptions.config || { containerID: genBrowserId.generateId() };

                // Handlers for each data object type.
                typeHandlers = {
                    'data:genome:fasta:': function (item) {
                        var baseUrl = API_DATA_URL + item.id + '/download/seq',
                            lbl = item.static.name,
                            purgeStoreDefer = $q.defer();

                        if ($scope.browser.config.stores) {
                            // Purge refseqs store before loading new one.
                             $scope.browser.getStore('refseqs', function (store) {
                                var seqTrackName;
                                if (!store) {
                                    purgeStoreDefer.resolve();
                                    return;
                                }
                                seqTrackName = store.config.label;
                                if (lbl == seqTrackName) {
                                    purgeStoreDefer.reject();
                                    return;
                                }
                                // remove all tracks if we're changing sequence.
                                $scope.genBrowserOptions.removeTracks($scope.browser.config.tracks);
                                delete $scope.browser.config.stores['refseqs'];
                                if ($scope.browser._storeCache) delete $scope.browser._storeCache['refseqs'];
                                 purgeStoreDefer.resolve();
                            });
                        } else {
                            purgeStoreDefer.resolve();
                        }

                        purgeStoreDefer.promise.then(function () {
                            reloadRefSeqs(baseUrl + '/refSeqs.json').then(function () {
                                addTrack({
                                    type:        'JBrowse/View/Track/Sequence',
                                    storeClass:  'JBrowse/Store/Sequence/StaticChunked',
                                    urlTemplate: 'seq/{refseq_dirpath}/{refseq}-',
                                    baseUrl:     baseUrl,
                                    category:    'Reference sequence',
                                    label:       lbl
                                });
                            });
                        });
                    },
                    'data:alignment:bam:': function (item) {
                        var url = API_DATA_URL + item.id + '/download/';

                        addTrack({
                            type: 'JBrowse/View/Track/Alignments2',
                            storeClass: 'JBrowse/Store/SeqFeature/BAM',
                            category: 'NGS',
                            urlTemplate: url + item.output.bam.file,
                            baiUrlTemplate: url + item.output.bai.file,
                            label: item.static.name
                        })
                        .then(function () {
                            var bigWigFile = _.findWhere(item.output.bam.refs || [], function(ref){
                                return ref.substr(-3) === '.bw';
                            });

                            if (typeof bigWigFile === 'undefined') return;

                            addTrack({
                                type: 'JBrowse/View/Track/Wiggle/XYPlot',
                                storeClass: 'JBrowse/Store/SeqFeature/BigWig',
                                label: item.static.name + ' Coverage',
                                urlTemplate: url + bigWigFile,
                                min_score: 0,
                                max_score: 35
                            });
                        });
                    }
                };

                // Gets JBrowse track. Searches by label.
                getTrackByLabel = function (lbl) {
                    return _.findWhere($scope.browser.config.tracks || [], {label: lbl});
                };

                // Reloads reference sequences.
                reloadRefSeqs = function (newRefseqsUrl) {
                    var deferredRefSeqs,
                        deferredSetup,
                        setupFn;

                    delete $scope.browser._deferred['reloadRefSeqs'];
                    deferredSetup = $scope.browser._getDeferred('reloadRefSeqs');
                    setupFn = function () {
                        if (!('allRefs' in $scope.browser) || _.keys($scope.browser.allRefs).length == 0) {
                            return;
                        }
                        _.each($scope.browser.allRefs, function (r){
                            $scope.browser.refSeqSelectBox.addOption({
                                label: r.name,
                                value: r.name
                            });
                        });

                        deferredSetup.resolve(true);
                    };

                    $scope.browser.allRefs = {};
                    $scope.browser.refSeq = null;
                    $scope.browser.refSeqOrder = [];
                    $scope.browser.refSeqSelectBox.removeOption($scope.browser.refSeqSelectBox.getOptions());
                    $scope.browser.refSeqSelectBox.set('value', '');

                    $scope.browser.config['refSeqs'] = {
                        url: newRefseqsUrl
                    };

                    delete $scope.browser._deferred['loadRefSeqs'];

                    deferredRefSeqs = $scope.browser.loadRefSeqs();
                    deferredRefSeqs.then(setupFn);

                    return deferredSetup;
                };

                // Adds track to JBrowse.
                addTrack = function (trackCfg) {
                    var isSequenceTrack = trackCfg.type == 'JBrowse/View/Track/Sequence',
                        alreadyExists = getTrackByLabel(trackCfg.label) !== undefined,
                        promise;

                    if (alreadyExists) {
                        notify({message: "Track " + trackCfg.label + " is already present in the viewport.", type: "danger"});
                        return;
                    }

                    // prepare for config loading.
                    $scope.browser.config.include = [];
                    if ($scope.browser.reachedMilestone('loadConfig')) {
                        delete $scope.browser._deferred['loadConfig'];
                    }

                    $scope.browser.config.include.push({
                        format: 'JB_json',
                        version: 1,
                        data: {
                            sourceUrl: trackCfg.baseUrl || '#',
                            tracks: [trackCfg]
                        }
                    });

                    promise = $scope.browser.loadConfig();
                    promise.then(function () {
                        // NOTE: must be in this order, since navigateToLocation will set reference sequence name,
                        // which will be used for loading sequence chunks.
                        if (isSequenceTrack) {
                            $scope.browser.navigateToLocation({ref: _.values($scope.browser.allRefs)[0].name});
                        }

                        $scope.browser.showTracks([trackCfg.label]);
                    });

                    return promise;
                };

                // Publicly exposed API.
                $scope.genBrowserOptions.addTrack = function (item) {
                    if (item.type in typeHandlers) {
                        typeHandlers[item.type](item);

                        if (item.type in ($scope.genBrowserOptions.afterAdd || {})) {
                            $scope.genBrowserOptions.afterAdd[item.type].call($scope.browser);
                        }
                    } else {
                        console.log('No handler for data type ' + item.type + ' defined.');
                    }
                };

                $scope.genBrowserOptions.removeTracks = function (tracks) {
                    var trackCfgs = [],
                        t;
                    if (_.isString(tracks)) {
                        this.removeTracks([tracks]);
                        return;
                    } else if (_.isArray(tracks)) {
                        _.each(tracks, function (trackCfg) {
                            if (_.isString(trackCfg)) {
                                t = getTrackByLabel(trackCfg);
                                if (typeof t !== 'undefined') trackCfgs.push(t);
                            } else if (_.isObject(trackCfg)) {
                                trackCfgs.push(trackCfg);
                            }
                        });
                    }
                    $scope.browser.publish('/jbrowse/v1/v/tracks/delete', trackCfgs);
                };

                // Execute some misc. things before we initialize JBrowse
                preConnect = function () {
                    var $el = $('#' + $scope.config['containerID']),
                        $footer = $('footer').first(),
                        height;

                    // Set fixed or automatic height
                    if (_.isNumber($scope.genBrowserOptions.size)) {
                        height = $scope.genBrowserOptions.size;
                    } else {
                        height = $(window).height() - $footer.height();
                    }
                    $el.height(height);
                };
                // Executes some misc. things when JBrowse intilializes.
                connector = function () {
                    // remove global menu bar
                    $scope.browser.afterMilestone('initView', function () {
                        dojo.destroy($scope.browser.menuBar);
                    });
                    // make sure tracks detached from the view ('hidden') actually are deleted in the browser instance
                    $scope.browser.subscribe('/jbrowse/v1/c/tracks/hide', function (trackCfgs) {
                        $scope.browser.publish('/jbrowse/v1/v/tracks/delete', trackCfgs);
                    });

                    if (_.isFunction($scope.genBrowserOptions.onConnect || {})) {
                        $scope.genBrowserOptions.onConnect.call($scope.browser);
                    }
                };

                // JBrowse initialization.
                require(['JBrowse/Browser', 'dojo/io-query', 'dojo/json'], function (Browser, ioQuery, JSON) {
                    // monkey-patch. We need to remove default includes, since off-the-shelf version of JBrowse
                    // forces loading of jbrowse.conf even if we pass empty array as includes.
                    Browser.prototype._configDefaults = function () {
                        return {
                            containerId: 'gen-browser',
                            dataRoot: API_DATA_URL,
                            baseUrl: API_DATA_URL,
                            browserRoot: '/static/jbrowse-1.11.4',
                            show_tracklist: false,
                            show_nav: true,
                            show_overview: true,
                            refSeqs: '/static/genapp-jbrowse/refSeqs_dummy.json',
                            nameUrl: '/static/genapp-jbrowse/names_dummy.json',
                            highlightSearchedRegions: false,
                            makeFullViewURL: false,
                            updateBrowserURL: false,
                            highResolutionMode: 'enabled',
                            suppressUsageStatistics: true,
                            include: [],
                            tracks: [],
                            datasets: {
                                _DEFAULT_EXAMPLES: false
                            }
                        };
                    };

                    preConnect();
                    $scope.browser = new Browser($scope.config);
                    connector();
                });
            }]
        };
    }]);