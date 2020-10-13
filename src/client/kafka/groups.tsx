import React from "react";
import CircularProgress from '@material-ui/core/CircularProgress';
import { RouteComponentProps } from "react-router-dom";
import { CellProps, CellButton } from '../common/cell_button';
import { KafkaToolbar} from '../common/toolbar';
import { DataView} from '../common/data_view';
import { ErrorMsg} from '../common/error_msg';
import { Url } from "../common/url";

type State = {
    search: string;
    loading: boolean;
    error: any;
    rows: any[];
}

class ViewMembersButton extends React.Component<CellProps, {}> {
    render() {
        return <CellButton getUrl={() => `/members/${this.props.data.groupId}`} {...this.props} />
    }
}

export class Groups extends React.Component<RouteComponentProps, State> {
    state: State = { loading: true, rows: [], search: "", error: "" }
    url: Url;

    constructor(props: RouteComponentProps) {
        super(props);
        this.url = new Url(props.location.search, ``);
    }

    async componentDidMount() {
        const response = await fetch(`/api/groups`)
        const data = await response.json()
        if (data.error) {
            this.setState({loading: false, error: data.error})
            return
        }
        const results = data.groups.map((r: any) => {
            return { numMembers: r.members.length, raw: r, history: this.props.history, ...r }
        })
        const search = this.url.Get(`search`) || ``
        this.setState({ loading: false, rows: results, search })
    }

    getColumnDefs() {
        return [
            { headerName: "Group ID", field: "groupId" },
            { headerName: "Protocol", field: "protocol" },
            { headerName: "Protocol Type", field: "protocolType" },
            { headerName: "State", field: "state" },
            { headerName: "#Members", field: "numMembers", filter: "agNumberColumnFilter", cellRendererFramework: ViewMembersButton }
        ]
    }

    render() {
        return (
            <>
                <KafkaToolbar
                    title="Groups"
                    url={this.url}
                    searchText={this.state.search}
                    onSearch={e => this.setState({ search: e.target.value })}>
                </KafkaToolbar>
                {this.state.loading && <><CircularProgress /><div>Loading...</div></>}
                <ErrorMsg error={this.state.error} prefix="Failed to fetch groups. Error: "></ErrorMsg>
                {!this.state.loading && <DataView
                    searchQuery={this.state.search}
                    search={r => r.groupId.includes(this.state.search) || r.protocol.includes(this.state.search) || r.protocolType.includes(this.state.search)}
                    rows={this.state.rows}
                    raw={this.state.rows.map(r => r.raw)}
                    url={this.url}
                    columnDefs={this.getColumnDefs()}>
                </DataView>}
            </>
        )
    }
}