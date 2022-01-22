import {
	IExecuteFunctions,
} from 'n8n-core';

import {
	IDataObject,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';

import {
	reportFields,
	reportOperations,
} from './ReportDescription';

import {
	userActivityFields,
	userActivityOperations,
} from './UserActivityDescription';

import {
	googleApiRequest,
	googleApiRequestAllItems,
	merge,
	simplify,
} from './GenericFunctions';

import * as moment from 'moment-timezone';

import {
	IData,
} from './Interfaces';

export class GoogleAds implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Google Ads',
		name: 'googleAds',
		icon: 'file:google-ads.png',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Use the Google Ads API',
		defaults: {
			name: 'Google Ads',
			color: '#772244',
		},
		inputs: ['main'],
		outputs: ['main'],
		credentials: [
			{
				name: 'googleApi',
				required: true,
				displayOptions: {
					show: {
						authentication: [
							'serviceAccount',
						],
					},
				},
			},
			{
				name: 'googleAdsOAuth2',
				required: true,
				displayOptions: {
					show: {
						authentication: [
							'oAuth2',
						],
					},
				},
			},
		],
		properties: [
			{
				displayName: 'Authentication',
				name: 'authentication',
				type: 'options',
				options: [
					{
						name: 'OAuth2',
						value: 'oAuth2',
					},
					{
						name: 'Service Account',
						value: 'serviceAccount',
					},
				],
				default: 'oAuth2',
			},
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				options: [
					{
						name: 'Report',
						value: 'report',
					},
					{
						name: 'User Activity',
						value: 'userActivity',
					},
				],
				default: 'report',
			},
			//-------------------------------
			// Reports Operations
			//-------------------------------
			...reportOperations,
			...reportFields,

			//-------------------------------
			// User Activity Operations
			//-------------------------------
			...userActivityOperations,
			...userActivityFields,
		],
	};

	methods = {
		loadOptions: {
			// Get all the dimensions to display them to user so that he can
			// select them easily
			async getDimensions(
				this: ILoadOptionsFunctions,
			): Promise<INodePropertyOptions[]> {
				const returnData: INodePropertyOptions[] = [];
				const { items: dimensions } = await googleApiRequest.call(
					this,
					'GET',
					'',
					{},
					{},
					'https://www.googleapis.com/ads/v3/metadata/ga/columns',
				);

				for (const dimesion of dimensions) {
					if (dimesion.attributes.type === 'DIMENSION' && dimesion.attributes.status !== 'DEPRECATED') {
						returnData.push({
							name: dimesion.attributes.uiName,
							value: dimesion.id,
							description: dimesion.attributes.description,
						});
					}
				}

				returnData.sort((a, b) => {
					const aName= a.name.toLowerCase();
					const bName= b.name.toLowerCase();
					if (aName < bName) { return -1; }
					if (aName > bName) { return 1; }
					return 0;
				});

				return returnData;
			},
			// Get all the views to display them to user so that he can
			// select them easily
			async getViews(
				this: ILoadOptionsFunctions,
			): Promise<INodePropertyOptions[]> {
				const returnData: INodePropertyOptions[] = [];
				const { items } = await googleApiRequest.call(
					this,
					'GET',
					'',
					{},
					{},
					'https://www.googleapis.com/ads/v3/management/accounts/~all/webproperties/~all/profiles',
				);

				for (const item of items) {
					returnData.push({
						name: item.name,
						value: item.id,
						description: item.websiteUrl,
					});
				}
				return returnData;
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {

		const items = this.getInputData();
		const returnData: IDataObject[] = [];
		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;

		let method = '';
		const qs: IDataObject = {};
		let endpoint = '';
		let responseData;
		for (let i = 0; i < items.length; i++) {
			try {
				if(resource === 'report') {
					if(operation === 'get') {
						//https://developers.google.com/ads/devguides/reporting/core/v4/rest/v4/reports/batchGet
						method = 'POST';
						endpoint = '/v4/reports:batchGet';
						const viewId = this.getNodeParameter('viewId', i) as string;
						const returnAll = this.getNodeParameter('returnAll', 0) as boolean;
						const additionalFields = this.getNodeParameter(
							'additionalFields',
							i,
						) as IDataObject;
						const simple = this.getNodeParameter('simple', i) as boolean;

						const body: IData = {
							viewId,
						};

						if (additionalFields.useResourceQuotas) {
							qs.useResourceQuotas = additionalFields.useResourceQuotas;
						}
						if (additionalFields.dateRangesUi) {
							const dateValues = (additionalFields.dateRangesUi as IDataObject).dateRanges as IDataObject;
							if (dateValues) {
								const start = dateValues.startDate as string;
								const end = dateValues.endDate as string;
								Object.assign(
									body,
									{
										dateRanges:
											[
												{
													startDate: moment(start).utc().format('YYYY-MM-DD'),
													endDate: moment(end).utc().format('YYYY-MM-DD'),
												},
											],
									},
								);
							}
						}

						if (additionalFields.metricsUi) {
							const metrics = (additionalFields.metricsUi as IDataObject).metricValues as IDataObject[];
							body.metrics = metrics;
						}
						if (additionalFields.dimensionUi) {
							const dimensions = (additionalFields.dimensionUi as IDataObject).dimensionValues as IDataObject[];
							if (dimensions) {
								body.dimensions = dimensions;
							}
						}
						if (additionalFields.dimensionFiltersUi) {
							const dimensionFilters = (additionalFields.dimensionFiltersUi as IDataObject).filterValues as IDataObject[];
							if (dimensionFilters) {
								dimensionFilters.forEach(filter => filter.expressions = [filter.expressions]);
								body.dimensionFilterClauses = { filters: dimensionFilters };
							}
						}

						if (additionalFields.includeEmptyRows) {
							Object.assign(body, { includeEmptyRows: additionalFields.includeEmptyRows });
						}
						if (additionalFields.hideTotals) {
							Object.assign(body, { hideTotals: additionalFields.hideTotals });
						}
						if (additionalFields.hideValueRanges) {
							Object.assign(body, { hideTotals: additionalFields.hideTotals });
						}

						if (returnAll === true) {
							responseData = await googleApiRequestAllItems.call(this, 'reports', method, endpoint, { reportRequests: [body] }, qs);
						} else {
							responseData = await googleApiRequest.call(this, method, endpoint, { reportRequests: [body] }, qs);
							responseData = responseData.reports;
						}

						if (simple === true) {
							responseData = simplify(responseData);
						} else if (returnAll === true && responseData.length > 1) {
							responseData = merge(responseData);
						}
					}
				}
				if (resource === 'userActivity') {
					if (operation === 'search') {
						//https://developers.google.com/ads/devguides/reporting/core/v4/rest/v4/userActivity/search
						method = 'POST';
						endpoint = '/v4/userActivity:search';
						const viewId = this.getNodeParameter('viewId', i);
						const userId = this.getNodeParameter('userId', i);
						const returnAll = this.getNodeParameter('returnAll', 0) as boolean;
						const additionalFields = this.getNodeParameter(
							'additionalFields',
							i,
						) as IDataObject;
						const body: IDataObject = {
							viewId,
							user: {
								userId,
							},
						};
						if (additionalFields.activityTypes) {
							Object.assign(body, { activityTypes: additionalFields.activityTypes });
						}

						if (returnAll) {
							responseData = await googleApiRequestAllItems.call(this, 'sessions', method, endpoint, body);
						} else {
							body.pageSize = this.getNodeParameter('limit', 0) as number;
							responseData = await googleApiRequest.call(this, method, endpoint, body);
							responseData = responseData.sessions;
						}
					}
				}
				if (Array.isArray(responseData)) {
					returnData.push.apply(returnData, responseData as IDataObject[]);
				} else if (responseData !== undefined) {
					returnData.push(responseData as IDataObject);
				}
			} catch (error) {
				if (this.continueOnFail()) {
					//@ts-ignore
					returnData.push({ error: error.message });
					continue;
				}
				throw error;
			}
		}
		return [this.helpers.returnJsonArray(returnData)];
	}
}
