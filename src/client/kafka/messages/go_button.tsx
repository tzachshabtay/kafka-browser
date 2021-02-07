import React from "react";
import Button from '@material-ui/core/Button';
import PlayArrowIcon from '@material-ui/icons/PlayArrow';
import CircularProgress from '@material-ui/core/CircularProgress';

interface Props {
    isRunning: boolean;
    onClick: () => void;
}

export const GoButton: React.FunctionComponent<Props> = (props) => {
    return (
    <div>
        <Button color="primary" variant="contained" style={{ marginTop: 18 }} disabled={props.isRunning}
            onClick={() => props.onClick()} endIcon={props.isRunning ? <CircularProgress size={18} color="secondary" /> : <PlayArrowIcon />}>
            GO
        </Button>
    </div>
    )
}